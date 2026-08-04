#!/usr/bin/env python3
"""
Convert the NeST main-model CX2 hierarchy into an HCX (Hierarchical CX2) network
linked to the IAS interaction network stored in NDEx.

HCX spec: https://cytoscape.org/cx/cx2/hcx-specification/

What this adds to the plain hierarchy:
  networkAttributes (required by HCX)
    ndexSchema                 = "hierarchy_v0.1"
    HCX::modelFileCount        = 2   (this hierarchy file + the interaction network)
    HCX::interactionNetworkUUID= <NDEx UUID of the IAS network>
  node attributes
    HCX::isRoot   (boolean)         true on the root system, false otherwise
    HCX::members  (list_of_long)    CX node ids of this system's genes IN the IAS
                                    interaction network (the link)
    HCX::memberNames (list_of_string) parallel gene symbols (circle-packing labels)

The link works because NDEx preserves CX2 node ids: node id N in IAS_network.cx2
(name = gene symbol) is the same id N in the uploaded NDEx network. We therefore
map each system's `Genes` symbols -> IAS node ids via IAS_network.cx2.

Genes in a system that are absent from the IAS interaction network (e.g. the root's
full-genome padding, or IL36G/SPAAR) have no node to point at and are omitted from
HCX::members (still listed in the untouched `Genes` attribute).
"""
import argparse, csv, json, sys
from collections import OrderedDict

# NDEx UUID of the IAS interaction network. Verified 2026-08-03 against the NDEx API:
# "IAS integrated protein-association network (NeST / Zheng et al. 2021)", 16840 nodes /
# 209996 edges. (Was previously e3bb3a6d-878e-11f1-857e-005056ae3c32, which was wrong.)
INTERACTION_UUID = "4731187a-8796-11f1-857e-005056ae3c32"


def aspect_map(cx2):
    """Return {aspect_name: payload} for the single-key aspect dicts (order kept elsewhere)."""
    out = {}
    for a in cx2:
        if isinstance(a, dict) and len(a) == 1:
            out[next(iter(a))] = a[next(iter(a))]
    return out


def build_symbol_to_id(ias_path):
    cx2 = json.load(open(ias_path))
    A = aspect_map(cx2)
    return {n["v"]["n"]: n["id"] for n in A["nodes"]}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", default="NeST Map - Main Model.cx2")
    ap.add_argument("--ias",   default="IAS_network.cx2", help="local IAS CX2 (for symbol->node id)")
    ap.add_argument("--uuid",  default=INTERACTION_UUID, help="NDEx UUID of the IAS interaction network")
    ap.add_argument("--out",   default="NeST_hierarchy_HCX.cx2")
    args = ap.parse_args()

    sym2id = build_symbol_to_id(args.ias)
    cx2 = json.load(open(args.model))
    A = aspect_map(cx2)
    nodes = A["nodes"]
    edges = A.get("edges", [])

    # ---- identify the root: edges run parent(s) -> child(t), so the root is the
    #      unique node that is never a child (never an edge target).
    targets = {e["t"] for e in edges}
    never_target = [n for n in nodes if n["id"] not in targets]
    if len(never_target) != 1:
        sys.exit(f"ERROR: expected exactly one root (never a target), found {len(never_target)}: "
                 f"{[n['v'].get('n') for n in never_target]}")
    root = never_target[0]
    root_id = root["id"]
    by_name_root = [n for n in nodes if n["v"].get("n") == "NEST"]
    if by_name_root and by_name_root[0]["id"] != root_id:
        print(f"WARNING: structural root (id {root_id}, name {root['v'].get('n')}) "
              f"!= name-'NEST' root", file=sys.stderr)

    # ---- augment nodes with HCX attributes
    total_genes = 0; total_mapped = 0; unmapped_syms = set()
    for n in nodes:
        genes = (n["v"].get("Genes") or "").split()
        pairs = []
        for g in genes:
            nid = sym2id.get(g)
            if nid is not None:
                pairs.append((nid, g))
            else:
                unmapped_syms.add(g)
        pairs.sort()                                   # deterministic, by interaction-node id
        total_genes += len(genes); total_mapped += len(pairs)
        n["v"]["HCX::isRoot"] = (n["id"] == root_id)
        n["v"]["HCX::members"] = [p[0] for p in pairs]
        n["v"]["HCX::memberNames"] = [p[1] for p in pairs]

    # ---- attribute declarations: add the new node attrs + HCX network attrs
    decls = A["attributeDeclarations"][0]
    decls.setdefault("nodes", {})
    decls["nodes"]["HCX::isRoot"]      = {"d": "boolean"}
    decls["nodes"]["HCX::members"]     = {"d": "list_of_long"}
    decls["nodes"]["HCX::memberNames"] = {"d": "list_of_string"}
    decls.setdefault("networkAttributes", {})
    decls["networkAttributes"]["ndexSchema"]                 = {"d": "string"}
    decls["networkAttributes"]["HCX::modelFileCount"]        = {"d": "integer"}
    decls["networkAttributes"]["HCX::interactionNetworkUUID"]= {"d": "string"}

    # ---- network attributes: add HCX schema + link
    na = A["networkAttributes"][0]
    na["ndexSchema"] = "hierarchy_v0.1"
    na["HCX::modelFileCount"] = 2
    na["HCX::interactionNetworkUUID"] = args.uuid

    json.dump(cx2, open(args.out, "w"))

    # ---- report
    n_members = sum(1 for n in nodes if n["v"]["HCX::members"])
    print(f"wrote {args.out}")
    print(f"  system nodes ........... {len(nodes)}   (root id {root_id}, name '{root['v'].get('n')}')")
    print(f"  containment edges ...... {len(edges)}")
    print(f"  nodes with >=1 member .. {n_members}")
    print(f"  gene->member mapping ... {total_mapped:,}/{total_genes:,} gene slots mapped "
          f"({100*total_mapped/total_genes:.1f}%)")
    print(f"  distinct unmapped syms . {len(unmapped_syms)} (not in the IAS interaction network)")
    print(f"  interactionNetworkUUID . {args.uuid}")
    rn = root["v"]
    print(f"  root members ........... {len(rn['HCX::members']):,} of {len((rn.get('Genes') or '').split()):,} root genes")
    # sample non-root node
    ex = next(n for n in nodes if not n["v"]["HCX::isRoot"] and n["v"]["HCX::members"])
    print(f"  sample node '{ex['v'].get('n')}': isRoot={ex['v']['HCX::isRoot']}, "
          f"{len(ex['v']['HCX::members'])} members e.g. "
          f"{list(zip(ex['v']['HCX::members'][:3], ex['v']['HCX::memberNames'][:3]))}")


if __name__ == "__main__":
    main()
