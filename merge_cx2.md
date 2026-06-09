# `merge_cx2.py`

Merges multiple NCI-PID CX2 network files into a single, deduplicated, NDEx-loadable CX2 network, preserving INDRA relationship evidence.

## What it produces

One CX2 file with:

- **Nodes deduplicated across files** by their namespaced `represents` identifier (e.g. `uniprot:O14636`), so a gene appearing in many pathways becomes one node.
- **Edges deduplicated and collapsed** so that two nodes never have more than two edges between them (one per direction), while INDRA evidence is preserved (unioned, never dropped).
- **A slimmed `Relationships` field** that keeps exactly the INDRA items the `bio-cx2-to-rdf` converter consumes and discards the surrounding HTML chrome — lossless for RDF, much smaller for the browser.
- **Spec-compliant structure**: every node has coordinates, every emitted aspect is declared in `metaData`, and `status` is the final aspect.
- *(Optional)* **Pathway-provenance nodes**: one node per source file, linked to every node that came from that file.

## Usage

```bash
python merge_cx2.py <input_dir> <output_file> [flags]
```

With no arguments it defaults to `cx2_networks/` → `merged_ncipid.cx2`.

```bash
# typical run
python merge_cx2.py cx2_networks/ merged_ncipid.cx2

# add pathway-membership nodes
python merge_cx2.py cx2_networks/ merged_ncipid.cx2 --pathway-nodes
```

### Arguments

| Argument | Required | Description |
|---|---|---|
| `input_dir` | yes (defaults to `cx2_networks`) | Directory scanned for `*.cx2` files. Files are processed in sorted filename order; that order determines which file "wins" for first-seen attributes, coordinates, and visual styling. |
| `output_file` | yes (defaults to `merged_ncipid.cx2`) | Path for the merged CX2 output. |

### Flags

| Flag | Default | Effect |
|---|---|---|
| `--no-slim` | slimming **on** | Keep the full original `Relationships` HTML instead of reducing it to converter-relevant items. Produces a larger file; output is otherwise identical. Useful for an RDF before/after diff. |
| `--no-collapse` | collapse **on** | Skip the direction-aware edge collapse. Edges are still deduplicated by full content, but redundant same-direction edges are not merged and the ≤2-edges-per-pair rule is not enforced. |
| `--pathway-nodes` | **off** | Add one `type: "pathway"` node per source file, plus a `participates in` edge from each pathway node to every node that came from that file. A node in multiple files receives an edge from each. These edges carry no `Relationships`, so they produce no INDRA evidence; the `bio-cx2-to-rdf` converter turns them into `protein RO:0000056 pathway` (participates in) triples. |

## How it works — the passes

The core function `merge_cx2_files()` runs the following passes in order. Each pass depends on the previous one's output being in a particular state, so ordering is deliberate.

### Pass 1 — Parse (`parse_cx2`)

A CX2 file is a JSON array of single-key dicts, one per *aspect* (`{"nodes": [...]}`, `{"edges": [...]}`, etc.). `parse_cx2` flattens that array into a single dict keyed by aspect name, so downstream code can do `aspects["nodes"]` directly. List-valued aspects that appear more than once are concatenated (supports CX2 files that split an aspect across fragments); scalar aspects are overwritten. No validation, id rewriting, or evidence parsing happens here — it is purely structural.

### Pass 2 — Node merge with cross-file dedup (`get_node_key` + node loop)

For each node, `get_node_key` builds a dedup key:

- It reads the identifier from `represents`/`r`/`name`/`n` (long key or CX2 alias), falling back to the raw node id.
- If the identifier is **namespaced** (contains `:`, e.g. `uniprot:O14636`), it is returned as-is so the node **merges across files**.
- If it is a **bare name** (no `:`, e.g. `RAS family`), it is prefixed with the file index (`__file0__RAS family`) so unrelated entities sharing a display name across pathways are **not** wrongly merged.

The loop maintains:

- `unified_nodes`: dedup key → merged node (assigned a fresh sequential id).
- `node_id_map`: `(file_idx, old_id)` → unified id, used by Pass 3 to remap edges.
- `node_file_membership`: unified id → set of source-file indices it appeared in, used by the pathway-node step.
- `unified_coords`: unified id → coordinate, read from inline `x`/`y`/`z` on the node or from a `cartesianLayout` aspect; first file's position wins.

When a node reappears, missing attributes are filled in and list attributes (`alias`, `member`) are unioned (order-preserving, deduplicated). Source `attributeDeclarations` are also accumulated here (first declaration of each key wins) so the output reuses the originals rather than synthesizing them.

### Pass 3 — Edge remap + full-content dedup (`edge_signature` + edge loop)

Each edge's `s`/`t` (old per-file ids) are translated to unified ids via `node_id_map`. `edge_signature` then fingerprints the edge as `(src, tgt, sha1(sorted JSON of all attributes))`. Edges with identical endpoints **and** byte-identical attribute payloads collapse to one; anything differing — including different INDRA evidence — is kept. This is the conservative dedup: it removes only perfect duplicates and never risks losing distinct evidence.

### Pass 4 — Direction-aware collapse (`collapse_directed_edges`)

Enforces the rule that two nodes have at most two edges between them (one per direction). Because a CX2 edge's `s`/`t` order is arbitrary relative to the evidence, direction identity comes from the **INDRA URL**, not the endpoints: `edge_direction_key` extracts `agent0`/`agent1` from the `Relationships` URL and groups edges by that ordered agent pair (falling back to node ids when no INDRA URL is present).

Within each direction group, all `<li/>` evidence items are collected into a **union** (deduplicated by the full `(text, url, count)` tuple), and the group is emitted as a single edge carrying that union. Identical evidence collapses to a pure drop; differing evidence is merged losslessly. `check_pair_limit` then flags any node pair still exceeding two edges as a data anomaly rather than force-merging it. Skipped entirely with `--no-collapse`.

### Pass 5 — Slim `Relationships` (`slim_relationships_html`)

Runs after collapse, on the final merged evidence. The `bio-cx2-to-rdf` converter reads each relationship via one regex matching `<li/>TEXT(<a href="URL">COUNT</a>)`. This pass re-extracts exactly those items and rebuilds a minimal `Relationships` string from them, dropping the `All Evidences` wrapper and other markup the converter ignores. The result is **lossless for RDF** (identical triples) while substantially smaller. Skipped with `--no-slim`.

### Pass 6 — Pathway-provenance nodes (optional, `--pathway-nodes`)

Creates one `type: "pathway"` node per source file (named after the file with any trailing version marker like ` _v2_0_` stripped, positioned on a ring around the existing layout) and one `participates in` edge from each pathway node to every unified node in `node_file_membership`. A node present in N files receives N such edges. Membership edges have no `Relationships`, so they contribute no INDRA evidence; in RDF they become `participates in` (`RO:0000056`) triples and are trivially filterable.

### Output assembly

Finally the script:

- Reuses the accumulated source `attributeDeclarations`, synthesizing a declaration only for any attribute key no source declared (alias-aware, so it never double-declares a key already covered by an alias).
- Builds a `cartesianLayout` aspect covering **every** node, assigning fallback grid positions to any node that lacked coordinates (NDEx rejects a layout that omits any node).
- Emits aspects in spec order — `CXVersion`, `metaData`, `attributeDeclarations`, `networkAttributes`, `nodes`, `edges`, `cartesianLayout`, optional `visualProperties`/`visualEditorProperties` — with `metaData` listing every aspect actually present, and **`status` last** (a misplaced `status` terminates the CX2 stream early and triggers NDEx's "End of array expected" error).

## Ordering rationale

| Step | Why it must run where it does |
|---|---|
| Dedup (3) before collapse (4) | Dedup hashes original full content; collapse needs the original evidence items to union correctly. |
| Collapse (4) before slim (5) | Slimming changes the `Relationships` string; collapse must union the original items first. |
| Pathway nodes (6) after collapse | So provenance edges are not themselves collapsed or deduplicated. |
| `status` last | A `status` aspect anywhere but the end terminates the CX2 stream early. |

## Notes and caveats

- **Coordinates are per-file.** Each source file's layout lives in its own coordinate space, so merged nodes from different pathways may overlap visually. The output is valid and loads, but you will likely want to re-run a layout in Cytoscape/NDEx for a meaningful arrangement.
- **Visual styling carries from the first file.** `visualProperties`/`visualEditorProperties` are taken from the first file that provides them. The NCI-PID style already includes a `pathway` node type, so `--pathway-nodes` renders distinctly with no extra work.
- **Lossless verification.** To confirm slimming/collapse changed no RDF triples, merge once with `--no-slim --no-collapse` and once normally, run both through `bio-cx2-to-rdf`, and diff the sorted unique triples (`diff <(sort -u full.ttl) <(sort -u merged.ttl)`).
