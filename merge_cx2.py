"""
Merge multiple CX2 network files into a single unified CX2 network.

Nodes are deduplicated by their 'represents' attribute (falling back to 'name').
Bare-name keys (no namespace ':') are scoped per-file so unrelated entities like
'RAS family' from different pathways are NOT merged; namespaced keys (e.g.
'uniprot:P01116') ARE merged across files.

Edges are remapped to the unified node IDs and deduplicated by full content:
two edges with the same endpoints AND identical attribute payload (including the
INDRA HTML blob) collapse into one. Edges that differ in any attribute -- e.g.
distinct INDRA evidence -- are kept separate.

After merging, each edge's 'Relationships' HTML is losslessly slimmed: only the
items the bio-cx2-to-rdf converter's regex consumes
(<li/>TEXT(<a href="URL">COUNT</a>)) are kept, dropping the "All Evidences"
wrapper and other chrome the converter ignores. RDF output is unchanged; the
file shrinks for Cytoscape.js. Pass --no-slim to keep full HTML.

Usage:
    python merge_cx2.py cx2_networks/ merged_ncipid.cx2
    python merge_cx2.py cx2_networks/ merged_ncipid.cx2 --no-slim
"""

import json
import os
import re
import sys
import glob
import hashlib
from collections import OrderedDict


# Mirror the bio-cx2-to-rdf converter's regex EXACTLY so slimming keeps
# precisely what it would read and nothing more.
_REL_ITEM_PATTERN = re.compile(
    r'<li/>([^<]+)\(<a\s+href="([^"]+)"[^>]*>(\d+)</a>\)'
)


def slim_relationships_html(html):
    """Rebuild Relationships from only the items the converter's regex matches."""
    if not isinstance(html, str) or not html:
        return html
    items = [
        f'<li/>{m.group(1)}(<a href="{m.group(2)}">{m.group(3)}</a>)'
        for m in _REL_ITEM_PATTERN.finditer(html)
    ]
    return "".join(items)


_URL_AGENTS = re.compile(r'agent0=([^&]+)&agent1=([^&]+)')


def edge_direction_key(s, t, v):
    """
    Identity of an edge's relationship for collapse grouping.

    Uses the INDRA agent0/agent1 order from the Relationships URL, which is the
    true directional identity -- the CX2 s/t endpoint order is arbitrary
    relative to the evidence (they disagree on ~half of edges). Falls back to
    the node-id pair only when no INDRA URL is present.
    """
    rel = (v or {}).get("Relationships", "") or ""
    m = _URL_AGENTS.search(rel)
    if m:
        return ("indra", m.group(1), m.group(2))
    return ("nodes", s, t)


def extract_rel_items(html):
    """Return the ordered list of (text, url, count) items the converter reads."""
    if not isinstance(html, str) or not html:
        return []
    return [(m.group(1), m.group(2), m.group(3))
            for m in _REL_ITEM_PATTERN.finditer(html)]


def items_to_html(items):
    """Rebuild minimal Relationships HTML from (text, url, count) items."""
    return "".join(f'<li/>{t}(<a href="{u}">{c}</a>)' for t, u, c in items)


def collapse_directed_edges(unified_edges):
    """
    Collapse edges sharing the same relationship direction.

    Direction identity comes from the INDRA agent0/agent1 order in the
    Relationships URL (see edge_direction_key) -- NOT the CX2 s/t order, which
    is arbitrary relative to the evidence. Keying on the ordered agent pair
    keeps the two genuine directions of a pair separate while merging redundant
    copies within a direction, yielding <=2 edges per node pair.

    Within a direction:
      - identical evidence (same <li/> item set)  -> keep one edge
      - differing evidence                         -> union the items into one edge
    The collapsed edge keeps the first member's s/t and non-Relationships
    attributes (merge-incidental: source pathway, flags).

    Returns (collapsed_edges, stats_dict).
    """
    groups = OrderedDict()  # direction_key -> list of edges
    for e in unified_edges:
        k = edge_direction_key(e["s"], e["t"], e.get("v"))
        groups.setdefault(k, []).append(e)

    collapsed = []
    next_id = 0
    n_dropped = 0          # exact-evidence duplicate copies removed
    n_unioned_groups = 0   # groups whose differing evidence was merged

    for dir_key, edges in groups.items():
        if len(edges) == 1:
            e = dict(edges[0]); e["id"] = next_id
            collapsed.append(e); next_id += 1
            continue

        # Collect the union of evidence items across the group, order-preserving,
        # deduped by the full (text, url, count) tuple.
        seen_items = OrderedDict()
        per_edge_sets = []
        for e in edges:
            its = extract_rel_items((e.get("v") or {}).get("Relationships"))
            per_edge_sets.append(frozenset(its))
            for it in its:
                seen_items.setdefault(it, None)

        distinct_payloads = len(set(per_edge_sets))
        if distinct_payloads > 1:
            n_unioned_groups += 1
        n_dropped += len(edges) - 1  # group becomes a single edge

        base = dict(edges[0])
        base["id"] = next_id
        v = dict(base.get("v") or {})
        if "Relationships" in v or seen_items:
            v["Relationships"] = items_to_html(list(seen_items.keys()))
        base["v"] = v
        collapsed.append(base)
        next_id += 1

    stats = {
        "groups": len(groups),
        "input_edges": len(unified_edges),
        "output_edges": len(collapsed),
        "dropped": n_dropped,
        "unioned_groups": n_unioned_groups,
    }
    return collapsed, stats


def check_pair_limit(collapsed_edges, limit=2):
    """Return list of (frozenset{s,t}, count) for node pairs exceeding `limit` edges."""
    counts = {}
    for e in collapsed_edges:
        key = frozenset((e["s"], e["t"]))
        counts[key] = counts.get(key, 0) + 1
    return [(k, c) for k, c in counts.items() if c > limit]


def parse_cx2(filepath):
    """Parse a CX2 JSON file and return its aspect fragments."""
    with open(filepath, "r") as f:
        data = json.load(f)

    aspects = {}
    for fragment in data:
        for key, value in fragment.items():
            if key in aspects:
                if isinstance(aspects[key], list) and isinstance(value, list):
                    aspects[key].extend(value)
                else:
                    aspects[key] = value  # overwrite for singular aspects
            else:
                aspects[key] = value
    return aspects


def get_node_key(node, file_idx):
    """
    Return a dedup key for a node. Namespaced represents values (containing ':')
    are merged across files. Bare-name values are scoped per-file to avoid
    incorrectly merging unrelated entities from different pathways.

    Reads both long keys (represents/name) and their CX2 aliases (r/n), since
    source files may store either form in the node 'v' dict.
    """
    v = node.get("v", {})
    represents = (v.get("represents") or v.get("r")
                  or v.get("name") or v.get("n") or str(node["id"]))
    if ":" in represents:
        return represents
    return f"__file{file_idx}__{represents}"


def edge_signature(new_src, new_tgt, v):
    """
    Full-content signature: endpoints plus a hash of the entire attribute dict.
    Identical edges collapse; any difference in attributes (including INDRA
    evidence) keeps them separate.
    """
    blob = json.dumps(v, sort_keys=True) if v else ""
    h = hashlib.sha1(blob.encode("utf-8")).hexdigest()
    return (new_src, new_tgt, h)


def merge_cx2_files(input_dir, output_path, slim=True, collapse=True,
                    add_pathway_nodes=False, uuid_map=None):
    cx2_files = sorted(glob.glob(os.path.join(input_dir, "*.cx2")))
    if not cx2_files:
        print(f"No .cx2 files found in {input_dir}")
        sys.exit(1)

    print(f"Found {len(cx2_files)} CX2 files to merge.\n")

    unified_nodes = OrderedDict()      # node_key -> merged node dict (with new id)
    node_id_map = {}                   # (file_idx, old_node_id) -> unified_node_id
    unified_edges = []
    seen_edges = {}                    # edge_signature -> unified_edge_id

    next_node_id = 0
    next_edge_id = 0
    skipped_edges = 0
    duplicate_edges = 0

    # Base aspects pulled from the first file that provides them
    base_network_attrs = {}
    base_visual_properties = None
    base_visual_editor_properties = None

    # Accumulated attribute declarations from source files. Start from the first
    # file's declarations (which already validate in NDEx) and add any extra
    # attribute keys later files declare, so nothing in the data is undeclared.
    merged_node_decls = OrderedDict()
    merged_edge_decls = OrderedDict()
    merged_net_decls = OrderedDict()

    # unified_node_id -> set of file_idx that contributed that node
    node_file_membership = {}

    # unified_node_id -> {"node": id, "x":, "y":, "z"?} for cartesianLayout
    unified_coords = {}

    source_names = []

    for file_idx, filepath in enumerate(cx2_files):
        fname = os.path.basename(filepath)
        source_names.append(fname)
        print(f"[{file_idx + 1}/{len(cx2_files)}] Processing: {fname}")

        aspects = parse_cx2(filepath)

        if base_visual_properties is None and "visualProperties" in aspects:
            base_visual_properties = aspects["visualProperties"]
        if base_visual_editor_properties is None and "visualEditorProperties" in aspects:
            base_visual_editor_properties = aspects["visualEditorProperties"]
        if not base_network_attrs and "networkAttributes" in aspects:
            base_network_attrs = aspects["networkAttributes"]

        # Accumulate attribute declarations (first declaration of a key wins).
        decl_aspect = aspects.get("attributeDeclarations")
        if isinstance(decl_aspect, list) and decl_aspect:
            decl = decl_aspect[0] if isinstance(decl_aspect[0], dict) else {}
            for k, v in (decl.get("nodes") or {}).items():
                merged_node_decls.setdefault(k, v)
            for k, v in (decl.get("edges") or {}).items():
                merged_edge_decls.setdefault(k, v)
            for k, v in (decl.get("networkAttributes") or {}).items():
                merged_net_decls.setdefault(k, v)

        nodes = aspects.get("nodes", [])
        edges = aspects.get("edges", [])

        # Capture node coordinates. Sources may store them either inline on the
        # node (x/y/z) or in a separate cartesianLayout aspect ({node, x, y, z}).
        cl_aspect = aspects.get("cartesianLayout") or []
        old_coords = {}
        if isinstance(cl_aspect, list):
            for c in cl_aspect:
                if isinstance(c, dict) and "node" in c:
                    old_coords[c["node"]] = c

        # Deduplicate nodes
        for node in nodes:
            old_id = node["id"]
            key = get_node_key(node, file_idx)

            if key not in unified_nodes:
                new_node = {
                    "id": next_node_id,
                    "v": dict(node.get("v", {})),
                }
                unified_nodes[key] = new_node
                next_node_id += 1
            else:
                # Merge extra attributes from the duplicate node
                existing = unified_nodes[key]
                for attr_key, attr_val in node.get("v", {}).items():
                    if attr_key not in existing["v"]:
                        existing["v"][attr_key] = attr_val
                    elif attr_key in ("alias", "member"):
                        existing_list = existing["v"][attr_key]
                        if isinstance(existing_list, list) and isinstance(attr_val, list):
                            existing["v"][attr_key] = list(
                                OrderedDict.fromkeys(existing_list + attr_val)
                            )

            node_id_map[(file_idx, old_id)] = unified_nodes[key]["id"]
            node_file_membership.setdefault(
                unified_nodes[key]["id"], set()).add(file_idx)

            # Record coordinate for this unified node (first one wins).
            uid = unified_nodes[key]["id"]
            if uid not in unified_coords:
                x = node.get("x")
                y = node.get("y")
                z = node.get("z")
                if x is None and old_id in old_coords:
                    src = old_coords[old_id]
                    x, y, z = src.get("x"), src.get("y"), src.get("z")
                if x is not None and y is not None:
                    coord = {"node": uid, "x": x, "y": y}
                    if z is not None:
                        coord["z"] = z
                    unified_coords[uid] = coord

        # Remap edges, dedup by full content
        file_kept = 0
        file_dupes = 0
        for edge in edges:
            new_src = node_id_map.get((file_idx, edge["s"]))
            new_tgt = node_id_map.get((file_idx, edge["t"]))

            if new_src is None or new_tgt is None:
                print(f"  WARNING: skipping edge with unmapped node(s): "
                      f"s={edge.get('s')} t={edge.get('t')}")
                skipped_edges += 1
                continue

            sig = edge_signature(new_src, new_tgt, edge.get("v"))
            if sig in seen_edges:
                duplicate_edges += 1
                file_dupes += 1
                continue

            new_edge = {"id": next_edge_id, "s": new_src, "t": new_tgt}
            if "v" in edge:
                new_edge["v"] = edge["v"]
            unified_edges.append(new_edge)
            seen_edges[sig] = next_edge_id
            file_kept += 1
            next_edge_id += 1

        print(f"    edges: {file_kept} kept, {file_dupes} duplicate")

    print(f"\nMerged result: {len(unified_nodes)} nodes, {len(unified_edges)} edges")
    total_seen = len(unified_edges) + duplicate_edges
    pct = (duplicate_edges / total_seen * 100) if total_seen else 0
    print(f"  Dropped {duplicate_edges} exact-duplicate edges "
          f"({pct:.1f}% of {total_seen} total)")
    if skipped_edges:
        print(f"  Skipped {skipped_edges} edges with unmapped nodes")

    # Collapse redundant edges sharing the same directed endpoints so that a
    # node pair never has more than 2 edges (one per direction). Runs before
    # slimming because unioning differing evidence needs the original items.
    if collapse:
        unified_edges, cstats = collapse_directed_edges(unified_edges)
        print(f"  Collapsed directed duplicates: "
              f"{cstats['input_edges']} -> {cstats['output_edges']} edges "
              f"({cstats['dropped']} redundant removed across "
              f"{cstats['groups']} directed pairs)")
        if cstats["unioned_groups"]:
            print(f"    {cstats['unioned_groups']} groups had differing "
                  f"evidence -> unioned (lossless, no items dropped)")
        violations = check_pair_limit(unified_edges, limit=2)
        if violations:
            worst = max(c for _, c in violations)
            print(f"  WARNING: {len(violations)} node pairs still exceed 2 edges "
                  f"(worst: {worst}). These have >2 distinct directions and were "
                  f"NOT force-merged -- review as data anomalies.")
        else:
            print(f"  OK: no node pair exceeds 2 edges.")

    # Slim Relationships HTML on the merged edges (lossless for RDF conversion)
    if slim:
        rel_before = rel_after = rel_slimmed = 0
        for edge in unified_edges:
            v = edge.get("v")
            if not v or "Relationships" not in v:
                continue
            original = v["Relationships"]
            if isinstance(original, str):
                rel_before += len(original)
            new_html = slim_relationships_html(original)
            rel_after += len(new_html) if isinstance(new_html, str) else 0
            if new_html != original:
                rel_slimmed += 1
            v["Relationships"] = new_html
        saved_pct = ((rel_before - rel_after) / rel_before * 100) if rel_before else 0
        print(f"  Slimmed Relationships on {rel_slimmed} edges: "
              f"{rel_before:,} -> {rel_after:,} B ({saved_pct:.1f}% reduction)")

    # Add pathway-provenance nodes: one node per source file, with an edge to
    # every unified node that came from that file. A node appearing in multiple
    # files therefore receives an edge from each pathway node. These membership
    # edges carry NO 'Relationships' field and a distinct interaction
    # ("participates in"), so bio-cx2-to-rdf parses no INDRA triples from them
    # and they are easy to filter downstream.
    if add_pathway_nodes:
        # Compute fresh id maxima (collapse reassigned edge ids from 0).
        next_nid = (max((n["id"] for n in unified_nodes.values()), default=-1) + 1)
        next_eid = (max((e["id"] for e in unified_edges), default=-1) + 1)

        def lookup_uuid(fname):
            """Resolve a source filename to its NDEx UUID via uuid_map.
            Tries the full filename and the basename without extension."""
            if not uuid_map:
                return None
            base = os.path.splitext(fname)[0]
            return uuid_map.get(fname) or uuid_map.get(base)

        pathway_node_ids = {}  # file_idx -> pathway node id
        # Spread pathway nodes in a ring around the existing layout so they are
        # visually separable; ensures every pathway node has coordinates too.
        import math
        xs = [c["x"] for c in unified_coords.values()] or [0]
        ys = [c["y"] for c in unified_coords.values()] or [0]
        cx = (min(xs) + max(xs)) / 2.0
        cy = (min(ys) + max(ys)) / 2.0
        span = max(max(xs) - min(xs), max(ys) - min(ys), 1.0)
        radius = span * 0.75
        n_files = len(source_names)
        missing_uuids = []
        for file_idx, fname in enumerate(source_names):
            # Strip a trailing version marker from the filename, e.g.
            # "IL5-mediated signaling events _v2_0_" -> "IL5-mediated signaling events".
            pname = re.sub(r"\s*_v\d+(?:[._]\d+)*_?\s*$", "",
                           os.path.splitext(fname)[0]).strip()
            pv = {"n": pname, "r": f"pathway:{pname}", "type": "pathway"}
            uuid = lookup_uuid(fname)
            if uuid:
                pv["ndex_id"] = f"ndex:{uuid}"
            else:
                missing_uuids.append(fname)
            pnode = {"id": next_nid, "v": pv}
            unified_nodes[f"__pathway__{file_idx}"] = pnode
            pathway_node_ids[file_idx] = next_nid
            angle = (2 * math.pi * file_idx) / max(n_files, 1)
            unified_coords[next_nid] = {
                "node": next_nid,
                "x": cx + radius * math.cos(angle),
                "y": cy + radius * math.sin(angle),
            }
            next_nid += 1

        membership_edges = 0
        for unode_id, file_idxs in node_file_membership.items():
            for file_idx in sorted(file_idxs):
                unified_edges.append({
                    "id": next_eid,
                    "s": pathway_node_ids[file_idx],
                    "t": unode_id,
                    "v": {"i": "participates in"},
                })
                next_eid += 1
                membership_edges += 1

        print(f"  Added {len(source_names)} pathway nodes and "
              f"{membership_edges} membership edges")
        if uuid_map and missing_uuids:
            print(f"  WARNING: no UUID found for {len(missing_uuids)} file(s): "
                  f"{', '.join(missing_uuids[:5])}"
                  f"{' ...' if len(missing_uuids) > 5 else ''}")

    # Build the merged CX2 document (spec-compliant aspect order).
    # CRITICAL: 'status' MUST be the LAST aspect; placing it second terminates
    # the stream early and triggers NDEx's "End of array expected" error.
    net_attrs = (base_network_attrs if isinstance(base_network_attrs, list)
                 else [base_network_attrs])
    merged_attrs = net_attrs[0] if net_attrs else {}
    merged_attrs["name"] = "NCI-PID Merged Network"
    merged_attrs["description"] = (
        f"Merged from {len(cx2_files)} NCI-PID CX2 files. "
        f"Nodes deduplicated by represents/name (bare names scoped per-file). "
        f"Edges deduplicated by full content. "
        + ("Relationships HTML slimmed to converter-relevant items. "
           if slim else "")
        + f"Sources: {', '.join(source_names)}"
    )

    node_list = list(unified_nodes.values())

    # Ensure EVERY node has a coordinate. NDEx rejects a cartesianLayout that
    # omits any node ("Coordinates missing in node N"). Lay out any node that
    # never got coords (e.g. source had none) on a fallback grid.
    import math as _math
    missing = [n["id"] for n in node_list if n["id"] not in unified_coords]
    if missing:
        xs = [c["x"] for c in unified_coords.values()] or [0.0]
        ys = [c["y"] for c in unified_coords.values()] or [0.0]
        base_x = min(xs)
        base_y = max(ys) + 50.0
        cols = max(1, int(_math.sqrt(len(missing))))
        for i, nid in enumerate(missing):
            unified_coords[nid] = {
                "node": nid,
                "x": base_x + (i % cols) * 30.0,
                "y": base_y + (i // cols) * 30.0,
            }
    # Order coordinates to match node order for cleanliness.
    cartesian_layout = [unified_coords[n["id"]] for n in node_list]

    # Use the source files' own declarations. Synthesize a fallback ONLY for an
    # attribute key that is neither declared directly nor already covered as the
    # alias ("a") of a declared attribute -- otherwise we'd double-declare a key
    # that the source already aliases (e.g. data uses "n", source declares
    # name -> a:n).
    def declared_keys(decls):
        keys = set(decls.keys())
        for d in decls.values():
            if isinstance(d, dict) and "a" in d:
                keys.add(d["a"])
        return keys

    alias_map = {"name": "n", "represents": "r"}
    node_decls = OrderedDict(merged_node_decls)
    known = declared_keys(node_decls)
    for node in node_list:
        for k, val in node.get("v", {}).items():
            if k in known:
                continue
            decl = {"d": "list_of_string" if isinstance(val, list) else "string"}
            if k in alias_map:
                decl["a"] = alias_map[k]
            node_decls[k] = decl
            known.add(k)

    edge_alias = {"interaction": "i"}
    edge_types = {"__relationship_score": "double",
                  "__directed": "boolean",
                  "__reverse_directed": "boolean"}
    edge_decls = OrderedDict(merged_edge_decls)
    known = declared_keys(edge_decls)
    for edge in unified_edges:
        for k, val in (edge.get("v") or {}).items():
            if k in known:
                continue
            if isinstance(val, list):
                dtype = "list_of_string"
            else:
                dtype = edge_types.get(k, "string")
            decl = {"d": dtype}
            if k in edge_alias:
                decl["a"] = edge_alias[k]
            edge_decls[k] = decl
            known.add(k)

    net_decls = OrderedDict(merged_net_decls)
    net_known = declared_keys(net_decls)
    for k in merged_attrs:
        if k not in net_known:
            net_decls[k] = {"d": "string"}
            net_known.add(k)

    meta = [
        {"name": "attributeDeclarations", "elementCount": 1},
        {"name": "networkAttributes", "elementCount": 1},
        {"name": "nodes", "elementCount": len(node_list)},
        {"name": "edges", "elementCount": len(unified_edges)},
        {"name": "cartesianLayout", "elementCount": len(cartesian_layout)},
    ]
    if base_visual_properties:
        meta.append({"name": "visualProperties",
                     "elementCount": len(base_visual_properties)
                     if isinstance(base_visual_properties, list) else 1})
    if base_visual_editor_properties:
        meta.append({"name": "visualEditorProperties",
                     "elementCount": len(base_visual_editor_properties)
                     if isinstance(base_visual_editor_properties, list) else 1})

    cx2_out = []
    cx2_out.append({"CXVersion": "2.0", "hasFragments": False})
    cx2_out.append({"metaData": meta})
    cx2_out.append({"attributeDeclarations": [{
        "nodes": dict(node_decls),
        "edges": dict(edge_decls),
        "networkAttributes": dict(net_decls),
    }]})
    cx2_out.append({"networkAttributes": [merged_attrs]})
    cx2_out.append({"nodes": node_list})
    cx2_out.append({"edges": unified_edges})
    cx2_out.append({"cartesianLayout": cartesian_layout})

    if base_visual_properties:
        cx2_out.append({"visualProperties": base_visual_properties})
    if base_visual_editor_properties:
        cx2_out.append({"visualEditorProperties": base_visual_editor_properties})

    # status LAST
    cx2_out.append({"status": [{"success": True}]})

    output_str = json.dumps(cx2_out)
    with open(output_path, "w") as f:
        f.write(output_str)

    size_mb = len(output_str) / 1024 / 1024
    print(f"Saved to {output_path} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    args = sys.argv[1:]
    slim = True
    collapse = True
    add_pathway_nodes = False
    uuid_map = None
    if "--no-slim" in args:
        slim = False
        args = [a for a in args if a != "--no-slim"]
    if "--no-collapse" in args:
        collapse = False
        args = [a for a in args if a != "--no-collapse"]
    if "--pathway-nodes" in args:
        add_pathway_nodes = True
        args = [a for a in args if a != "--pathway-nodes"]
    if "--uuid-map" in args:
        i = args.index("--uuid-map")
        try:
            map_path = args[i + 1]
        except IndexError:
            print("--uuid-map requires a path to a JSON file")
            sys.exit(1)
        with open(map_path) as f:
            uuid_map = json.load(f)
        del args[i:i + 2]

    if len(args) == 2:
        input_dir, output_path = args[0], args[1]
    elif len(args) == 0:
        input_dir, output_path = "cx2_networks", "merged_ncipid.cx2"
    else:
        print(f"Usage: {sys.argv[0]} <input_dir> <output_file> "
              f"[--no-slim] [--no-collapse] [--pathway-nodes] "
              f"[--uuid-map map.json]")
        sys.exit(1)

    merge_cx2_files(input_dir, output_path, slim=slim, collapse=collapse,
                    add_pathway_nodes=add_pathway_nodes, uuid_map=uuid_map)