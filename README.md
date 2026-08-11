# proto-okn

Two [Proto-OKN](https://www.proto-okn.net/) knowledge-graph contributions from the Cytoscape /
NDEx team, plus the tooling that builds them from source networks on [NDEx](https://www.ndexbio.org).

| Graph | Source | Output | Status |
|---|---|---|---|
| **NCI-PID 2.0 KG** | 207 NCI-PID pathway networks | `*.ttl` (766,276 triples) | deployed — [`apps.okn.us/ncipidkg/sparql`](https://apps.okn.us/ncipidkg/sparql) |
| **NeST + IAS KG** | NeST hierarchy + IAS interaction network | [`nest/nest.ttl`](nest/nest.ttl) (1,318,375 triples) | generated, **not yet deployed** |

> **The deployed NCI-PID graph is stale.** It predates the merge and several conversion fixes,
> so pathway provenance is absent from it and some entities are mistyped. See
> [remaining_issues.md](remaining_issues.md) — the converter is fixed; the graph needs a
> re-publish.

---

## Build the NCI-PID 2.0 KG

Three stages: download → merge → convert.

```
util/download-networks.mjs   →  data_files/*.cx2      (download from NDEx)
util/merge_cx2.py            →  merged_ncipid.cx2     (dedup + collapse + pathway nodes)
bio-cx2-to-rdf               →  ncipid-merged.ttl     (RDF Turtle)
```

### Prerequisites

- **Node.js** 20.17+ or 22.9+ (developed against Node 25) — for the downloader and converter
- **Python 3** — for the merge; standard library only, no packages to install

### 0. Download the source networks *(optional)*

[`data_files/`](data_files/) already contains all 207 networks, so **skip this unless you want
to refresh them from NDEx**.

```bash
cd util
npm install
npm run download          # reads data_files/network_list.csv, writes data_files/*.cx2
```

### 1. Merge into one network

```bash
cd util
python3 merge_cx2.py ../data_files merged_ncipid.cx2 \
    --pathway-nodes --uuid-map ../data_files/download-manifest.json
```

Both flags matter if you want to know **which pathway contains which nodes and edges**:

- `--pathway-nodes` adds one `type: "pathway"` node per source network, plus a
  `participates in` edge to every node that came from it.
- `--uuid-map` gives those pathway nodes a resolvable `ndex:<uuid>` identity instead of a
  dead `pathway:<name>` placeholder.

> ⚠️ **Write the merged file outside `data_files/`.** The input directory is scanned for
> `*.cx2`, so merged output left there is re-ingested on the next run.

Typical result — 2,679 nodes, 33,117 edges, **+207 pathway nodes and 8,055 membership
edges**, ~19 MB, about a second.

### 2. Convert to RDF

```bash
cd bio-cx2-to-rdf
npm install
npm run build
node dist/cli/index.js ../util/merged_ncipid.cx2 -o ncipid-merged.ttl -v
```

Typical result — 2,815 node declarations, 75,312 direct triples, 82,331 reified statements;
**766,276 triples**, ~36 MB, about two seconds.

Converting a **single** pathway network works the same way and needs no merge step:

```bash
node dist/cli/index.js "../data_files/ATM pathway (v2.0).cx2" -o atm.ttl
```

---

## Pathway provenance in the output

Membership survives the merge at both levels:

| Question | Predicate | Count in a full build |
|---|---|---|
| What pathways exist? | `a biolink:Pathway` | 207 |
| **Which pathway contains which node?** | `RO:0000056` (participates in) | 2,679 |
| **Which pathway contains which edge?** | `ncipidv:inPathway` on the reified statement | 80,989 |

```turtle
ndex:d0e5d311-45d0-11ed-b7d0-0ac135e8bacf a biolink:Pathway ;
    rdfs:label "ALK1 signaling events (v2.0)" .

uniprot:Q5VSQ9 RO:0000056 ndex:d0e5d311-45d0-11ed-b7d0-0ac135e8bacf .

ncipid:statement_0_0 a rdf:Statement ;
    rdf:subject uniprot:Q5VSQ9 ; rdf:predicate RO:0002629 ; rdf:object uniprot:A8K537 ;
    ncipidv:evidenceCount 18 ;
    ncipidv:evidenceUrl <https://db.indra.bio/statements/from_agents?…> ;
    ncipidv:inPathway ndex:d0e5d311-45d0-11ed-b7d0-0ac135e8bacf .
```

> **`ncipidv:inPathway` is a co-membership heuristic**, not exact provenance: an interaction is
> tagged with every pathway in which *both* endpoints participate, which is a **superset** of
> true edge membership. Node membership (`RO:0000056`) *is* exact. Exact per-edge provenance is
> a planned `merge_cx2.py` follow-up — see
> [bio-cx2-to-rdf/README.md](bio-cx2-to-rdf/README.md#merged-networks--pathway-provenance).

---

## Build the NeST + IAS KG

NeST is converted by standalone scripts, **not** through `bio-cx2-to-rdf` — a settled decision,
with the reasoning in [NEST_HIERARCHY_DATASET.md §9](NEST_HIERARCHY_DATASET.md).

```bash
cd nest
python3 nest_to_rdf.py 4f9210a1-8797-11f1-857e-005056ae3c32 -o nest.ttl
# or the byte-identical Node implementation:
node nest_to_rdf.mjs 4f9210a1-8797-11f1-857e-005056ae3c32 -o nest.ttl
```

Only the hierarchy UUID is required; the IAS interaction network UUID is read from the
hierarchy's own `HCX::interactionNetworkUUID` attribute. Downloads are cached, so re-runs are
offline (add `--offline` to require it).

---

## Tests

```bash
cd bio-cx2-to-rdf && npm test     # 102 tests, Node's built-in runner
```

Includes an end-to-end regression test per defect found in the published graph. See
[bio-cx2-to-rdf/README.md](bio-cx2-to-rdf/README.md#tests).

---

## Regenerating the vendored snapshots

Two generated-but-committed files keep conversion deterministic and offline. Both are checked
in; regenerate only when you intend to change the mappings, and **commit the result**.

```bash
cd bio-cx2-to-rdf
npm run refresh:bioregistry   # canonical IRI stems from Bioregistry
npm run normalize:chemicals   # chemical ids via the RENCI Node Normalizer, + review tables
```

`normalize:chemicals` writes a review set to [`chemical-normalization/`](chemical-normalization/).
**Normalization is not automatically safe** — the review table flags collisions and bad merges
that must be resolved before the mapping is accepted.

---

## Repository layout

| Path | Contents |
|---|---|
| [`data_files/`](data_files/) | 207 source NCI-PID CX2 networks + `network_list.csv`, `download-manifest.json` |
| [`util/`](util/) | `download-networks.mjs`, `merge_cx2.py` — see [util/README.md](util/README.md) |
| [`bio-cx2-to-rdf/`](bio-cx2-to-rdf/) | CX2 → RDF converter (TypeScript) — see [its README](bio-cx2-to-rdf/README.md) |
| [`nest/`](nest/) | NeST/IAS converters, source data, and `nest.ttl` |
| [`chemical-normalization/`](chemical-normalization/) | Node Normalizer review tables and snapshot |

## Documentation

| Doc | Covers |
|---|---|
| [CX2_TO_RDF_DESIGN.md](CX2_TO_RDF_DESIGN.md) | The NCI-PID RDF mapping — entity types, predicates, reification, pathway provenance |
| [NEST_HIERARCHY_DATASET.md](NEST_HIERARCHY_DATASET.md) | NeST hierarchy dataset design |
| [IAS_NETWORK_GENERATION.md](IAS_NETWORK_GENERATION.md) | IAS interaction network generation and modelling |
| [SYMBOL_TO_PROTEIN_MAPPING.md](SYMBOL_TO_PROTEIN_MAPPING.md) | Gene symbol → UniProt resolution |
| [util/merge_cx2.md](util/merge_cx2.md) | Merge internals, pass by pass |
| [remaining_issues.md](remaining_issues.md) | **Audited defect list** — read before publishing |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Historical build plan |
| [nci-pidkg.md](nci-pidkg.md) | OKN registry entry for the deployed graph |

> Where [CX2_TO_RDF_DESIGN.md](CX2_TO_RDF_DESIGN.md) and the implementation disagree, its §1.1
> divergence table records which is authoritative. Its normative sections (§4.x) track the
> converter; several longer worked examples are knowingly out of date and say so.
