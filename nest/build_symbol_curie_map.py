#!/usr/bin/env python3
"""
Build a symbol -> CURIE map for the IAS network (Data S1).

For every distinct gene symbol in the input network TSV, resolve a canonical
identifier CURIE:

  * proteins           -> uniprot:<accession>   (id_type = protein)
  * non-protein genes  -> hgnc:<numeric id>      (id_type = gene)

"Non-protein" = a symbol with no UniProt accession in HGNC, no accession via
its previous/alias symbol, and none via the UniProt REST fallback (pseudogenes,
ncRNA host genes, withdrawn/duplicate loci, and complex-locus constituents).
Those keep an HGNC gene identifier so the node is still identified and joinable,
just not typed as a protein.

Resolution order per symbol
---------------------------
Protein (uniprot:) —
  1. HGNC approved `symbol`         -> uniprot_ids
  2. HGNC `prev_symbol`  (renamed)  -> uniprot_ids   (only hits carrying a UniProt id)
  3. HGNC `alias_symbol`            -> uniprot_ids   (only hits carrying a UniProt id)
  4. UniProt REST fallback (cached) -> reviewed, then unreviewed, human exact gene
Gene fallback (hgnc:) —
  5. HGNC id of the approved symbol / its prev-symbol record / the withdrawn record
  6. last resort, symbol not in HGNC at all -> hgnc.symbol:<SYMBOL>

Inputs (download once; see SYMBOL_TO_PROTEIN_MAPPING.md)
  hgnc_complete_set.txt   HGNC complete set (symbol, uniprot_ids, prev/alias, hgnc_id)
  hgnc_withdrawn.txt      HGNC withdrawn report (withdrawn_symbol -> hgnc_id)
  uniprot_fallback_cache.json   written/read by this script; makes re-runs offline & deterministic

Output
  symbol_curie_map.tsv    symbol  curie  id_type  route  hgnc_id  all_uniprot  note
"""
import argparse, csv, json, os, sys, time, urllib.request, urllib.parse
from collections import defaultdict

HGNC_SET      = "hgnc_complete_set.txt"
HGNC_WITHDRAWN= "hgnc_withdrawn.txt"
CACHE         = "uniprot_fallback_cache.json"
UNIPROT_API   = "https://rest.uniprot.org/uniprotkb/search"


# ---------------------------------------------------------------- HGNC load
def load_hgnc():
    approved_up = {}                 # symbol -> [uniprot,...]
    sym2id      = {}                 # symbol -> HGNC:id
    prev_up     = defaultdict(list)  # prev_symbol  -> [(symbol,[uniprot],hgnc_id),...]
    alias_up    = defaultdict(list)  # alias_symbol -> [(symbol,[uniprot],hgnc_id),...]
    prev2id     = defaultdict(list)  # prev_symbol  -> [hgnc_id,...]
    with open(HGNC_SET, newline='') as f:
        for row in csv.DictReader(f, delimiter='\t'):
            if row.get("status") != "Approved":
                continue
            sym = row["symbol"]; hid = row["hgnc_id"]
            ups = [u for u in (row.get("uniprot_ids") or "").split('|') if u]
            approved_up[sym] = ups
            sym2id[sym] = hid
            for p in (row.get("prev_symbol") or "").split('|'):
                if p: prev_up[p].append((sym, ups, hid)); prev2id[p].append(hid)
            for a in (row.get("alias_symbol") or "").split('|'):
                if a: alias_up[a].append((sym, ups, hid))
    withdrawn2id = {}
    if os.path.exists(HGNC_WITHDRAWN):
        with open(HGNC_WITHDRAWN) as f:
            r = csv.reader(f, delimiter='\t'); next(r, None)
            for row in r:
                if len(row) >= 3: withdrawn2id[row[2]] = row[0]
    return approved_up, sym2id, prev_up, alias_up, prev2id, withdrawn2id


# ------------------------------------------------------------ UniProt fallback
def uniprot_lookup(sym):
    def q(query):
        url = UNIPROT_API + "?" + urllib.parse.urlencode(
            {'query': query, 'fields': 'accession,reviewed', 'format': 'tsv', 'size': '5'})
        with urllib.request.urlopen(url, timeout=30) as r:
            return [l.split('\t') for l in r.read().decode().splitlines()[1:]]
    for route, query in (("uniprot_api:reviewed_exact",   f'gene_exact:{sym} AND organism_id:9606 AND reviewed:true'),
                         ("uniprot_api:unreviewed_exact", f'gene_exact:{sym} AND organism_id:9606')):
        hits = q(query)
        if hits:
            return [h[0] for h in hits], route
    return [], "none"


# ------------------------------------------------------------------- resolve
def resolve(sym, H, cache):
    approved_up, sym2id, prev_up, alias_up, prev2id, withdrawn2id = H
    # ---- protein routes
    if approved_up.get(sym):
        return f"uniprot:{approved_up[sym][0]}", "protein", "approved_symbol", approved_up[sym]
    for src, tag in ((prev_up, "prev_symbol"), (alias_up, "alias_symbol")):
        withup = [h for h in src.get(sym, []) if h[1]]
        if withup:
            route = tag + ("_ambiguous" if len(withup) > 1 else "")
            return f"uniprot:{withup[0][1][0]}", "protein", route, withup[0][1]
    if sym not in cache:                       # UniProt REST (cached)
        cache[sym] = uniprot_lookup(sym); time.sleep(0.2)
    accs, route = cache[sym]
    if accs:
        return f"uniprot:{accs[0]}", "protein", route, accs
    # ---- gene fallback (no protein)
    hid = sym2id.get(sym) or (prev2id.get(sym) or [None])[0] or withdrawn2id.get(sym)
    if hid:                                    # HGNC:12345 -> hgnc:12345
        return f"hgnc:{hid.split(':',1)[1]}", "gene", "hgnc_id_fallback", []
    return f"hgnc.symbol:{sym}", "gene", "hgnc_symbol_fallback", []


# ---------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--network", default="science.abf3067_data_s1_to_s3/abf3067_Data_S1.tsv",
                    help="input network TSV (default: Data S1)")
    ap.add_argument("--p1-col", default="Protein 1")
    ap.add_argument("--p2-col", default="Protein 2")
    ap.add_argument("--out", default="symbol_curie_map.tsv")
    args = ap.parse_args()

    for f in (HGNC_SET,):
        if not os.path.exists(f):
            sys.exit(f"missing {f} — see SYMBOL_TO_PROTEIN_MAPPING.md for the download URL")

    # distinct symbols from the network
    symbols = set()
    with open(args.network, newline='') as f:
        r = csv.DictReader(f, delimiter='\t')
        for row in r:
            symbols.add(row[args.p1_col]); symbols.add(row[args.p2_col])
    symbols = sorted(symbols)

    H = load_hgnc()
    cache = json.load(open(CACHE)) if os.path.exists(CACHE) else {}

    rows = []
    for sym in symbols:
        curie, id_type, route, accs = resolve(sym, H, cache)
        note = ""
        if id_type == "gene":
            note = "no UniProt protein — kept HGNC gene identifier"
        rows.append((sym, curie, id_type, route, curie.split(':',1)[1] if curie.startswith('hgnc') else "",
                     "|".join(accs), note))

    json.dump(cache, open(CACHE, 'w'), indent=0)          # persist fallback

    with open(args.out, 'w', newline='') as g:
        w = csv.writer(g, delimiter='\t', lineterminator='\n')
        w.writerow(["symbol", "curie", "id_type", "route", "hgnc_id", "all_uniprot", "note"])
        w.writerows(rows)

    # ---- report
    prot = [r for r in rows if r[2] == "protein"]
    gene = [r for r in rows if r[2] == "gene"]
    distinct_prot = len({r[1] for r in prot})
    print(f"wrote {args.out}")
    print(f"  symbols ................. {len(rows):,}")
    print(f"  -> uniprot: (protein) ... {len(prot):,}  ({100*len(prot)/len(rows):.2f}%)  [{distinct_prot:,} distinct accessions]")
    print(f"  -> hgnc:    (gene) ...... {len(gene):,}")
    routes = defaultdict(int)
    for r in rows: routes[r[3]] += 1
    print("  routes:")
    for k in sorted(routes, key=lambda x:-routes[x]):
        print(f"     {k:28s} {routes[k]:>7,}")
    if gene:
        print(f"  gene-identifier (non-protein) symbols:")
        for r in gene:
            print(f"     {r[0]:12s} -> {r[1]}")


if __name__ == "__main__":
    main()
