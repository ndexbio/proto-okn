#!/usr/bin/env python3
"""
Generate a CX2 network from the filtered IAS edge list.

Node model (keyed on gene symbol -> simple graph, no info loss):
  * CX node id  = integer counter; the first time a gene symbol is seen (scanning
                  edges in file order) it is assigned the next integer, counter++.
  * name  (n)   = the gene symbol (unique -> one node per symbol)
  * represents (r) = UniProt CURIE, or HGNC gene CURIE for the 12 non-protein
                     symbols, taken from symbol_curie_map.tsv
  * type        = "protein" or "gene" (from the map's id_type)

Edge model (one edge per input row):
  * s / t       = node ids of Protein 1 / Protein 2
  * i           = "interacts with"  (RO:0002434, generic functional association)
  * the 6 numeric columns (integrated score + 5 evidence) are carried verbatim
  * edge_role   = core | backbone

Inputs
  --network  filtered edge list TSV (default: ias_network_no_orphans.tsv)
  --map      symbol_curie_map.tsv  (symbol -> curie, id_type)
Output
  --out      CX2 JSON (default: IAS_network.cx2)
"""
import argparse, csv, json, sys, os

# CX2 attribute value columns (TSV header -> CX2 edge attr name, declared type)
EDGE_ATTRS = [
    ("Integrated score",                "integrated_score",              "double"),
    ("evidence: Physical",              "physical_evidence",             "double"),
    ("evidence: mRNA co-expression",    "mrna_coexpression_evidence",    "double"),
    ("evidence: Protein co-expression", "protein_coexpression_evidence", "double"),
    ("evidence: Co-dependence",         "codependence_evidence",         "double"),
    ("evidence: Sequence similarity",   "sequence_similarity_evidence",  "double"),
    ("edge_role",                       "edge_role",                     "string"),
]

CONTEXT = {
    "uniprot":     "http://purl.uniprot.org/uniprot/",
    "hgnc":        "http://identifiers.org/hgnc/",
    "hgnc.symbol": "http://identifiers.org/hgnc.symbol/",
}

# Visual-style attribute references use the NDEx source's column names; remap them to
# this network's (snake_case) edge attribute names so data-driven mappings resolve.
COLUMN_REMAP = {
    "Integrated score":                "integrated_score",
    "evidence: Physical":              "physical_evidence",
    "evidence: mRNA co-expression":    "mrna_coexpression_evidence",
    "evidence: Protein co-expression": "protein_coexpression_evidence",
    "evidence: Co-dependence":         "codependence_evidence",
    "evidence: Sequence similarity":   "sequence_similarity_evidence",
}


def load_style(path):
    """Load the saved visual style and remap mapping attribute references to our columns."""
    style = json.load(open(path))
    vp = style["visualProperties"]
    for entry in vp:
        for mapkey in ("nodeMapping", "edgeMapping"):
            for _, m in entry.get(mapkey, {}).items():
                defn = m.get("definition", {})
                if "attribute" in defn:
                    defn["attribute"] = COLUMN_REMAP.get(defn["attribute"], defn["attribute"])
    return vp


def load_map(path):
    m = {}
    with open(path, newline='') as f:
        for row in csv.DictReader(f, delimiter='\t'):
            m[row["symbol"]] = (row["curie"], row["id_type"])
    return m


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--network", default="ias_network_no_orphans.tsv")
    ap.add_argument("--map",     default="symbol_curie_map.tsv")
    ap.add_argument("--out",     default="IAS_network.cx2")
    ap.add_argument("--p1-col",  default="Protein 1")
    ap.add_argument("--p2-col",  default="Protein 2")
    ap.add_argument("--style",   default="ias_visual_style.json",
                    help="visual style JSON to apply (set '' to skip)")
    args = ap.parse_args()

    sym2curie = load_map(args.map)

    # ---- assign node ids by first-seen order; build edges
    node_id = {}         # symbol -> int id
    nodes = []           # CX2 node objects
    edges = []
    counter = 0
    missing = set()

    with open(args.network, newline='') as f:
        r = csv.DictReader(f, delimiter='\t')
        header = r.fieldnames
        edge_cols = [(h, cx, ty) for (h, cx, ty) in EDGE_ATTRS if h in header]
        for row in r:
            ids = []
            for col in (args.p1_col, args.p2_col):
                sym = row[col]
                if sym not in node_id:
                    node_id[sym] = counter
                    curie, id_type = sym2curie.get(sym, (None, None))
                    if curie is None:
                        missing.add(sym); curie = f"hgnc.symbol:{sym}"; id_type = "gene"
                    nodes.append({"id": counter, "v": {"n": sym, "r": curie, "type": id_type}})
                    counter += 1
                ids.append(node_id[sym])
            v = {"i": "interacts with"}
            for (h, cx, ty) in edge_cols:
                val = row[h]
                v[cx] = float(val) if ty == "double" else val
            edges.append({"s": ids[0], "t": ids[1], "v": v})

    # edge ids continue after node ids (non-overlapping, matches NDEx convention)
    for i, e in enumerate(edges):
        e_out = {"id": counter + i, "s": e["s"], "t": e["t"], "v": e["v"]}
        edges[i] = e_out

    if missing:
        print(f"WARNING: {len(missing)} symbols not in map, fell back to hgnc.symbol: "
              f"{sorted(missing)[:10]}{'...' if len(missing)>10 else ''}", file=sys.stderr)

    # ---- attribute declarations
    node_decl = {
        "name":       {"a": "n", "d": "string"},
        "represents": {"a": "r", "d": "string"},
        "type":       {"d": "string"},
    }
    edge_decl = {"interaction": {"a": "i", "d": "string"}}
    for (h, cx, ty) in EDGE_ATTRS:
        edge_decl[cx] = {"d": ty}
    net_decl = {k: {"d": "string"} for k in
                ("name", "description", "version", "author", "disease", "organism", "reference", "@context")}

    network_attrs = {
        "name": "IAS integrated protein-association network (NeST / Zheng et al. 2021)",
        "description": ("Integrated Association Stringency (IAS) network, Data S1 of Zheng et al., "
                        "Science 374:eabf3067 (2021). Filtered to Integrated score >= 0.30 plus each "
                        "protein's single strongest edge (no orphan nodes; islands allowed). Nodes keyed "
                        "on HGNC gene symbol; represents = UniProt accession, or HGNC gene id for the 12 "
                        "symbols with no protein product. Edge scores carried verbatim."),
        "version": "1.0",
        # provenance fields, values from the NDEx deposit (UUID 60112105-f853-11e9-bb65-0ac135e8bacf)
        "author": "Fan Zheng",
        "disease": "cancer",
        "organism": "Human, 9606, Homo sapiens",
        "reference": "Zheng et al., Science 374:eabf3067 (2021). doi:10.1126/science.abf3067",
        "@context": json.dumps(CONTEXT),
    }

    visual = load_style(args.style) if args.style else None

    meta = [
        {"name": "attributeDeclarations", "elementCount": 1},
        {"name": "networkAttributes",     "elementCount": 1},
        {"name": "nodes",                 "elementCount": len(nodes)},
        {"name": "edges",                 "elementCount": len(edges)},
    ]
    if visual is not None:
        meta.append({"name": "visualProperties", "elementCount": len(visual)})

    cx2 = [
        {"CXVersion": "2.0", "hasFragments": False},
        {"metaData": meta},
        {"attributeDeclarations": [{"nodes": node_decl, "edges": edge_decl, "networkAttributes": net_decl}]},
        {"networkAttributes": [network_attrs]},
        {"nodes": nodes},
        {"edges": edges},
    ]
    if visual is not None:
        cx2.append({"visualProperties": visual})
    cx2.append({"status": [{"success": True}]})

    with open(args.out, "w") as g:
        json.dump(cx2, g)

    # ---- report
    n_prot = sum(1 for n in nodes if n["v"]["type"] == "protein")
    n_gene = sum(1 for n in nodes if n["v"]["type"] == "gene")
    n_core = sum(1 for e in edges if e["v"].get("edge_role") == "core")
    n_back = sum(1 for e in edges if e["v"].get("edge_role") == "backbone")
    print(f"wrote {args.out}  ({os.path.getsize(args.out)/1e6:.1f} MB)")
    print(f"  nodes .......... {len(nodes):,}   (protein {n_prot:,}, gene {n_gene})")
    print(f"  edges .......... {len(edges):,}   (core {n_core:,}, backbone {n_back:,})")
    print(f"  node id range .. 0 .. {len(nodes)-1}")
    print(f"  edge id range .. {len(nodes)} .. {len(nodes)+len(edges)-1}")
    print(f"  sample node .... {json.dumps(nodes[0])}")
    print(f"  sample edge .... {json.dumps(edges[0])}")


if __name__ == "__main__":
    main()
