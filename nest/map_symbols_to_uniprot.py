#!/usr/bin/env python3
"""
Map the HGNC gene symbols in the IAS network (Data S1) to UniProt accessions,
using the authoritative HGNC complete set.

Resolution order per symbol:
  1. exact match on HGNC approved `symbol`      -> uniprot_ids
  2. fallback: match on `prev_symbol` (renamed)  -> uniprot_ids
  3. fallback: match on `alias_symbol`           -> uniprot_ids
A symbol is "matched" if the chosen HGNC row has >=1 UniProt id.

Outputs:
  nest/symbol_to_uniprot.tsv   symbol  uniprot(canonical)  n_uniprot  match_route  all_uniprot
Reports:
  - how many symbols have no matched UniProt accession (and lists them)
  - collisions: UniProt accessions to which >1 symbol maps
"""
import csv, sys, json, os
from collections import defaultdict

HGNC = "hgnc_complete_set.txt"
SYMS = "ias_symbols.txt"
OUT  = "symbol_to_uniprot.tsv"
FALLBACK = "uniprot_fallback.json"   # {symbol: [accession, route, all]} from UniProt REST

# UniProt REST fallback for symbols HGNC leaves without a uniprot_id (HGNC gap).
fallback = {}
if os.path.exists(FALLBACK):
    for s, v in json.load(open(FALLBACK)).items():
        if v[0]:
            fallback[s] = (v[0], "uniprot_api:" + v[1])

# --- load HGNC ------------------------------------------------------------
approved = {}                      # symbol -> [uniprot,...]
prev     = defaultdict(list)       # prev_symbol -> [(symbol,[uniprot]),...]
alias    = defaultdict(list)       # alias_symbol -> [(symbol,[uniprot]),...]
with open(HGNC, newline='') as f:
    r = csv.DictReader(f, delimiter='\t')
    for row in r:
        if row.get("status") != "Approved":
            continue
        sym = row["symbol"]
        ups = [u for u in (row.get("uniprot_ids") or "").split('|') if u]
        approved[sym] = ups
        for p in (row.get("prev_symbol") or "").split('|'):
            if p: prev[p].append((sym, ups))
        for a in (row.get("alias_symbol") or "").split('|'):
            if a: alias[a].append((sym, ups))

# --- load network symbols -------------------------------------------------
symbols = [s.strip() for s in open(SYMS) if s.strip()]

def resolve(sym):
    if approved.get(sym):                   # approved AND carries a UniProt id
        return approved[sym], "approved_symbol"
    # prev/alias fallbacks, but only accept a hit that actually carries a UniProt id
    for src, tag in ((prev, "prev_symbol"), (alias, "alias_symbol")):
        withup = [h for h in src.get(sym, []) if h[1]]
        if len(withup) == 1:
            return withup[0][1], tag
        if len(withup) > 1:
            return withup[0][1], tag + "_ambiguous"
    if sym in fallback:                     # HGNC gap -> UniProt REST
        acc, route = fallback[sym]
        return [acc], route
    return [], "unmatched"

rows = []
sym2uni = {}
uni2syms = defaultdict(list)
for sym in symbols:
    ups, route = resolve(sym)
    canonical = ups[0] if ups else ""
    rows.append((sym, canonical, len(ups), route, "|".join(ups)))
    if canonical:
        sym2uni[sym] = canonical
        uni2syms[canonical].append(sym)

with open(OUT, 'w', newline='') as g:
    w = csv.writer(g, delimiter='\t', lineterminator='\n')
    w.writerow(["symbol", "uniprot", "n_uniprot", "match_route", "all_uniprot"])
    w.writerows(rows)

# --- report ---------------------------------------------------------------
total = len(symbols)
matched = sum(1 for r in rows if r[1])
unmatched = [r[0] for r in rows if not r[1]]
multi = [r for r in rows if r[2] > 1]
collisions = {u: s for u, s in uni2syms.items() if len(s) > 1}

routes = defaultdict(int)
for r in rows: routes[r[3]] += 1

print(f"wrote {OUT}")
print(f"\n=== COVERAGE ===")
print(f"total symbols ............ {total:,}")
print(f"matched to >=1 UniProt ... {matched:,}  ({100*matched/total:.2f}%)")
print(f"UNMATCHED (no protein) ... {len(unmatched):,}")
print("\nmatch route breakdown:")
for k in sorted(routes, key=lambda x:-routes[x]):
    print(f"   {k:24s} {routes[k]:>7,}")

print(f"\n=== SYMBOLS WITH >1 UniProt id (canonical = first listed) ===  {len(multi):,}")
for r in multi[:40]:
    print(f"   {r[0]:12s} -> {r[4]}")
if len(multi) > 40: print(f"   ... (+{len(multi)-40} more, see {OUT})")

print(f"\n=== COLLISIONS: one UniProt <- multiple symbols ===  {len(collisions):,} accessions")
distinct_after = len(set(sym2uni.values()))
print(f"   {matched:,} matched symbols collapse to {distinct_after:,} distinct UniProt accessions")
print(f"   -> {matched - distinct_after:,} symbols share an accession with another symbol")
for u, s in sorted(collisions.items(), key=lambda kv:-len(kv[1]))[:40]:
    print(f"   {u:12s} <- {' '.join(s)}")
if len(collisions) > 40: print(f"   ... (+{len(collisions)-40} more)")

if unmatched:
    print(f"\n=== UNMATCHED SYMBOLS ({len(unmatched)}) ===")
    for i in range(0, len(unmatched), 12):
        print("   " + " ".join(unmatched[i:i+12]))
