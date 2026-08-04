#!/usr/bin/env python3
"""
Resolve the NeST hierarchy's cancer-type codes (TCGA cohorts) to MONDO disease terms.

MONDO is the OKN-recommended disease vocabulary
(https://registry.okn.us/book/biomedical-identifiers/ -> http://purl.obolibrary.org/obo/MONDO_$1),
so these are the IRIs the RDF stage uses as the object of every system<->cancer-type
association (mutation frequency, HiSig significance).

WHY THIS IS NOT A PLAIN TEXT SEARCH
    Searching MONDO for a cohort code or name and taking the top hit is wrong often
    enough to matter: "LUSC" hits Luscan-Lumish syndrome, "BRCA" hits BRCA1-related
    cancer predisposition, "OV" hits 800+ terms, and KIRC/LIHC/LUAD/SKCM/UCEC hit
    nothing at all. Conversely the right term is frequently invisible to a label
    search because its TCGA alignment lives in its synonyms and xrefs -- e.g. TCGA
    BLCA is MONDO:0005611, whose *label* is "bladder transitional cell carcinoma"
    but which carries the exact synonym "BLCA" and the xref ONCOTREE:BLCA.

    So this script searches broadly, then VERIFIES each candidate against an anchor
    and records which anchor fired. Ranked strongest first:

      1 override        curator-pinned in the data file (still fetched + validated)
      2 oncotree_xref   term has xref ONCOTREE:<code>   <- OncoTree codes were designed
                                                           to align with TCGA cohorts
      3 exact_synonym   term has an exact synonym == <code>
      4 exact_label     term label == one of the curated search_terms
      5 synonym_match   term has a synonym == one of the curated search_terms

    Anything that resolves only at tier 5, or not at all, is flagged REVIEW in the
    output rather than reported as a clean mapping.

DETERMINISM
    Every OLS4 response is cached to --cache (default mondo_lookup_cache.json).
    Commit the cache and re-runs need no network; --offline hard-fails on a miss.

USAGE
    # regenerate the committed mapping from the data file
    python3 map_cancer_types_to_mondo.py

    # confirm the data file still covers every cohort in the hierarchy
    python3 map_cancer_types_to_mondo.py --check-cx2 NeST_hierarchy_HCX.cx2

    # one-off lookup of a single code or disease name
    python3 map_cancer_types_to_mondo.py --query BLCA
    python3 map_cancer_types_to_mondo.py --query "cutaneous melanoma"
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

OLS = "https://www.ebi.ac.uk/ols4/api"
MONDO_IRI_STEM = "http://purl.obolibrary.org/obo/MONDO_"

# Anchor strength, strongest first. The route recorded on each row is the best one
# that fired; TIER_REVIEW and weaker means the row needs a human.
TIERS = ["override", "oncotree_xref", "exact_synonym", "exact_label", "synonym_match"]
TIER_REVIEW = "synonym_match"  # this tier and anything unresolved is flagged


# ---------------------------------------------------------------- HTTP + cache

class Client:
    """OLS4 client with a JSON-file cache, so re-runs are offline and deterministic."""

    def __init__(self, cache_path, offline=False, delay=0.1):
        self.cache_path = cache_path
        self.offline = offline
        self.delay = delay
        self.hits = self.misses = 0
        self.cache = {}
        if cache_path and os.path.exists(cache_path):
            with open(cache_path) as fh:
                self.cache = json.load(fh)

    def get(self, url):
        if url in self.cache:
            self.hits += 1
            return self.cache[url]
        if self.offline:
            sys.exit(f"ERROR: --offline but {url} is not cached")
        self.misses += 1
        try:
            with urllib.request.urlopen(url, timeout=30) as resp:
                payload = json.load(resp)
        except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as exc:
            sys.exit(f"ERROR: OLS request failed ({exc})\n  {url}")
        self.cache[url] = payload
        time.sleep(self.delay)
        return payload

    def save(self):
        if not self.cache_path:
            return
        with open(self.cache_path, "w") as fh:
            json.dump(self.cache, fh, indent=1, sort_keys=True)

    def search(self, query, rows=8):
        """MONDO ids matching a free-text query, in OLS relevance order."""
        url = (f"{OLS}/search?q={urllib.parse.quote(query)}&ontology=mondo"
               f"&rows={rows}&fieldList=obo_id,label")
        docs = self.get(url).get("response", {}).get("docs", [])
        out = []
        for doc in docs:
            obo_id = doc.get("obo_id") or ""
            if obo_id.startswith("MONDO:") and obo_id not in out:
                out.append(obo_id)
        return out

    def term(self, mondo_id):
        """Full term record, or None if the id does not resolve."""
        iri = MONDO_IRI_STEM + mondo_id.split(":", 1)[1]
        url = f"{OLS}/ontologies/mondo/terms?iri={urllib.parse.quote(iri, safe='')}"
        terms = self.get(url).get("_embedded", {}).get("terms", [])
        return terms[0] if terms else None


# ---------------------------------------------------------------- term helpers

def oncotree_xref(term):
    for xref in term.get("obo_xref") or []:
        if (xref.get("database") or "").upper() == "ONCOTREE":
            return xref.get("id") or ""
    return ""


def synonyms(term):
    return [s for s in (term.get("synonyms") or []) if s]


def classify(term, code, search_terms):
    """Best anchor tying `term` to this cohort, or None. Returns (tier, detail)."""
    onc = oncotree_xref(term)
    if onc.upper() == code.upper():
        return "oncotree_xref", f"ONCOTREE:{onc}"

    for syn in synonyms(term):
        if syn.strip().upper() == code.upper():
            return "exact_synonym", f'synonym "{syn}"'

    wanted = {t.strip().lower() for t in search_terms if t.strip()}
    label = (term.get("label") or "").strip().lower()
    if label in wanted:
        return "exact_label", f'label "{term.get("label")}"'

    for syn in synonyms(term):
        if syn.strip().lower() in wanted:
            return "synonym_match", f'synonym "{syn}"'

    return None


def resolve(client, code, search_terms, override="", rows=8):
    """
    Resolve one cohort to a MONDO term.

    Returns a result dict. `route` is the anchor that won; `alternatives` lists any
    other candidate that matched at the same tier (a tie a curator should settle).
    """
    blank = {"code": code, "mondo_id": "", "mondo_label": "", "mondo_iri": "",
             "route": "unresolved", "anchor": "", "oncotree": "", "alternatives": "",
             "note": ""}

    if override:
        term = client.term(override)
        if term is None:
            return {**blank, "note": f"override {override} does not resolve in MONDO"}
        if term.get("is_obsolete"):
            return {**blank, "note": f"override {override} is obsolete in MONDO"}
        return {**blank, "mondo_id": override, "mondo_label": term.get("label") or "",
                "mondo_iri": MONDO_IRI_STEM + override.split(":", 1)[1],
                "route": "override", "anchor": "curator-pinned",
                "oncotree": oncotree_xref(term)}

    # Search by the code and by every curated label; dedupe, keep discovery order.
    candidates = []
    for query in [code] + list(search_terms):
        if not query.strip():
            continue
        for mondo_id in client.search(query, rows=rows):
            if mondo_id not in candidates:
                candidates.append(mondo_id)

    scored = []
    for mondo_id in candidates:
        term = client.term(mondo_id)
        if term is None or term.get("is_obsolete"):
            continue
        verdict = classify(term, code, search_terms)
        if verdict:
            tier, anchor = verdict
            scored.append((TIERS.index(tier), tier, anchor, mondo_id, term))

    if not scored:
        return {**blank, "note": f"no candidate matched an anchor "
                                 f"({len(candidates)} searched)"}

    scored.sort(key=lambda row: row[0])
    rank, tier, anchor, mondo_id, term = scored[0]
    ties = [r[3] for r in scored[1:] if r[0] == rank]

    note = ""
    if TIERS.index(tier) >= TIERS.index(TIER_REVIEW):
        note = "REVIEW: resolved only by a weak anchor"
    if ties:
        note = (note + "; " if note else "") + f"REVIEW: tie at tier {tier}"

    return {"code": code, "mondo_id": mondo_id, "mondo_label": term.get("label") or "",
            "mondo_iri": MONDO_IRI_STEM + mondo_id.split(":", 1)[1],
            "route": tier, "anchor": anchor, "oncotree": oncotree_xref(term),
            "alternatives": " ".join(ties), "note": note}


# ---------------------------------------------------------------- data file I/O

def read_types(path):
    rows = []
    with open(path) as fh:
        for lineno, line in enumerate(fh, 1):
            line = line.rstrip("\n")
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            parts = line.split("\t")
            if parts[0] == "code":  # header
                continue
            if len(parts) < 3:
                sys.exit(f"ERROR: {path}:{lineno}: expected >=3 tab-separated fields")
            parts += [""] * (5 - len(parts))
            code, cohort_name, terms, override, reason = parts[:5]
            if override and not reason.strip():
                sys.exit(f"ERROR: {path}:{lineno}: override {override} has no reason")
            rows.append({
                "code": code.strip(),
                "cohort_name": cohort_name.strip(),
                "search_terms": [t.strip() for t in terms.split("|") if t.strip()],
                "override_mondo": override.strip(),
                "override_reason": reason.strip(),
            })
    return rows


def check_cx2(cx2_path, codes):
    """Confirm the data file covers every cancer type the hierarchy actually uses."""
    with open(cx2_path) as fh:
        cx2 = json.load(fh)
    aspects = {next(iter(a)): a[next(iter(a))]
               for a in cx2 if isinstance(a, dict) and len(a) == 1}

    found = {k.split(":", 1)[1]
             for k in aspects["attributeDeclarations"][0].get("nodes", {})
             if k.startswith("Mutation frequency:")}
    for node in aspects["nodes"]:
        for key in ("Significantly mutated cancer types",
                    "Significantly mutated cancer types (aggregate)"):
            value = node["v"].get(key)
            if value:
                found.update(value.split())

    missing = sorted(found - set(codes))
    extra = sorted(set(codes) - found)
    print(f"cancer types in {os.path.basename(cx2_path)} : {len(found)}")
    print(f"cancer types in data file             : {len(codes)}")
    print(f"  missing from data file : {missing or 'none'}")
    print(f"  not used by hierarchy  : {extra or 'none'}")
    return not missing


# ---------------------------------------------------------------------- main

COLUMNS = ["code", "cohort_name", "mondo_id", "mondo_label", "mondo_iri",
           "route", "anchor", "oncotree", "alternatives", "note"]


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--types", default=os.path.join(here, "nest_cancer_types.tsv"),
                    help="input cancer-type data file")
    ap.add_argument("--out", default=os.path.join(here, "cancer_type_mondo_map.tsv"),
                    help="output mapping TSV")
    ap.add_argument("--cache", default=os.path.join(here, "mondo_lookup_cache.json"),
                    help="OLS response cache (commit for offline re-runs)")
    ap.add_argument("--offline", action="store_true",
                    help="fail instead of hitting the network on a cache miss")
    ap.add_argument("--rows", type=int, default=8,
                    help="candidates to pull per search query (default 8)")
    ap.add_argument("--check-cx2", metavar="CX2",
                    help="verify the data file covers every cohort in this hierarchy, then exit")
    ap.add_argument("--query", metavar="CODE_OR_NAME",
                    help="resolve a single code or disease name and print it, then exit")
    args = ap.parse_args()

    if args.check_cx2:
        rows = read_types(args.types)
        sys.exit(0 if check_cx2(args.check_cx2, [r["code"] for r in rows]) else 1)

    client = Client(args.cache, offline=args.offline)

    if args.query:
        result = resolve(client, args.query, [args.query], rows=args.rows)
        client.save()
        for key in COLUMNS:
            if key in result:
                print(f"  {key:14} {result[key]}")
        sys.exit(0 if result["mondo_id"] else 1)

    rows = read_types(args.types)
    results = []
    for row in rows:
        result = resolve(client, row["code"], row["search_terms"],
                         override=row["override_mondo"], rows=args.rows)
        result["cohort_name"] = row["cohort_name"]
        if row["override_reason"]:
            result["note"] = (result["note"] + "; " if result["note"] else "") \
                             + row["override_reason"]
        results.append(result)
    client.save()

    with open(args.out, "w") as fh:
        fh.write("\t".join(COLUMNS) + "\n")
        for result in results:
            fh.write("\t".join(str(result.get(c, "")) for c in COLUMNS) + "\n")

    # ---- report
    width = max(len(r["mondo_label"]) for r in results) if results else 20
    print(f"{'code':6} {'MONDO':16} {'label':{width}} {'route':14} anchor")
    print("-" * (6 + 16 + width + 14 + 22))
    for r in results:
        print(f"{r['code']:6} {r['mondo_id'] or '-':16} "
              f"{r['mondo_label'] or '-':{width}} {r['route']:14} {r['anchor']}")

    unresolved = [r for r in results if not r["mondo_id"]]
    review = [r for r in results if r["note"].startswith("REVIEW")]
    print(f"\nwrote {args.out}")
    print(f"  resolved ........ {len(results) - len(unresolved)}/{len(results)}")
    print(f"  by override ..... {sum(1 for r in results if r['route'] == 'override')}")
    print(f"  by OncoTree xref  {sum(1 for r in results if r['route'] == 'oncotree_xref')}")
    print(f"  needs review .... {len(review)} {[r['code'] for r in review] or ''}")
    print(f"  cache ........... {client.hits} hits, {client.misses} fetched -> {args.cache}")
    if unresolved:
        print(f"  UNRESOLVED ...... {[r['code'] for r in unresolved]}")
    sys.exit(1 if unresolved else 0)


if __name__ == "__main__":
    main()
