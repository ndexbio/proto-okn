# IAS Interaction Network — Generation Specification

**Status:** ✅ CX2 network implemented ([nest/build_cx2_network.py](nest/build_cx2_network.py) → [nest/IAS_network.cx2](nest/IAS_network.cx2)) · 🚧 RDF adapter pending
**Purpose:** Define exactly how the NeST / IAS protein-association network (Data S1 of Zheng et al., *Science* 374, eabf3067, 2021) is turned into a CX2 network and, downstream, into RDF for the OKN. This is the **interaction network** only. The NeST *hierarchy* (395 systems) is a separate graph, specified elsewhere ([NEST_HIERARCHY_DATASET.md](NEST_HIERARCHY_DATASET.md)).

**Companion docs:** symbol→identifier resolution is specified in [SYMBOL_TO_PROTEIN_MAPPING.md](SYMBOL_TO_PROTEIN_MAPPING.md). Pipeline of scripts and outputs is listed in §10.

---

## 0. How to build (end-to-end)

Three steps, all in `nest/`. Each script is parameterized (`--help` for options); defaults reproduce the committed outputs.

```bash
cd nest

# --- one-time inputs (record download date on refresh) ---
# Data S1 is already present at science.abf3067_data_s1_to_s3/abf3067_Data_S1.tsv
curl -sSL -o hgnc_complete_set.txt \
  https://storage.googleapis.com/public-download-files/hgnc/tsv/tsv/hgnc_complete_set.txt
curl -sSL -o hgnc_withdrawn.txt \
  https://storage.googleapis.com/public-download-files/hgnc/tsv/tsv/withdrawn.txt

# --- 1. filter the raw edge list (Data S1 -> filtered network) ---
python3 filter_ias_network.py \
  --network science.abf3067_data_s1_to_s3/abf3067_Data_S1.tsv \
  --ias-floor 0.30 \
  --out ias_network_no_orphans.tsv
#   -> 209,996 edges (204,768 core + 5,228 backbone), 16,840 proteins, 0 orphans

# --- 2. resolve gene symbols -> UniProt / HGNC CURIEs ---
#   (needs network access on first run for the ~24 UniProt REST fallbacks;
#    subsequent runs read uniprot_fallback_cache.json offline)
python3 build_symbol_curie_map.py \
  --network science.abf3067_data_s1_to_s3/abf3067_Data_S1.tsv \
  --out symbol_curie_map.tsv
#   -> 16,828 uniprot: + 12 hgnc: gene ids

# --- 3. generate the CX2 network (filtered edges + symbol map -> CX2) ---
python3 build_cx2_network.py \
  --network ias_network_no_orphans.tsv \
  --map symbol_curie_map.tsv \
  --out IAS_network.cx2
#   -> IAS_network.cx2 : 16,840 nodes, 209,996 edges
```

To regenerate at a different stringency, change `--ias-floor` in step 1 and re-run steps 1 and 3 (step 2 is threshold-independent — it maps every symbol in the source). Step details are in §3 (filter), §7 (mapping), §4 (CX2 model). Full artifact list in §10.

---

## 1. Source file

| | |
|---|---|
| File | `nest/science.abf3067_data_s1_to_s3/abf3067_Data_S1.tsv` |
| Origin | Supplementary Data S1, "Integrated association stringency (IAS) network." Archived TSV of the resource published at http://ccmi.org/nest/ (also on NDEx). |
| Format | Tab-separated values, one header row + one row per protein pair |
| Rows | 1,848,498 (verified) |
| Proteins | 16,840 distinct HGNC symbols (verified) |
| Encoding checks (verified) | 0 self-loops · 0 duplicate undirected pairs · 0 blank cells |

The file is already a **canonical undirected edge list** — every unordered protein pair appears at most once. No deduplication, self-loop removal, or missing-value handling is required.

### Relationship to the rest of the study (Fig. 1B)
Data S1 is pipeline **step (iii)** — the scored input network. The published *findings* live in the systems derived from it: Data S2 (2,338 systems) and Data S3 / NeST (395 systems). This spec covers only the flat scored network.

---

## 2. Column meanings (per the paper)

| Column | Meaning (Methods) |
|---|---|
| `Protein 1`, `Protein 2` | **HGNC gene symbols.** "we used the symbols of protein-coding genes in the HUGO Gene Nomenclature Committee database (HGNC), yielding 19,035 distinct proteins"; Ensembl/Entrez/UniProt were converted to HGNC in preprocessing. Undirected. |
| `Integrated score` | The **IAS score.** Output of the second-stage random forest, trained to predict **Resnik semantic similarity** of the pair over GO Biological-Process + Cellular-Component branches. It is a *granularity/stringency* measure of shared-system membership — **not** a probability, p-value, or binding score. Range in file: **0.181 – 1.000**. |
| `evidence: Physical` | Stage-1 model score from physical-interaction inputs (BioPlex 2.0, Hein et al., hu.MAP, HuRI, BioGRID multi-validated; each as sparse + node2vec features). The 1,722 new CCMI AP-MS interactions were injected by setting this feature to max **before** scoring — they are **not individually recoverable** from this column. |
| `evidence: mRNA co-expression` | Stage-1 score from mRNA co-expression (CCLE/GDSC, TCGA, GTEx). *Note:* the Methods split mRNA co-expression into three stage-1 categories; the TSV ships one aggregate column. |
| `evidence: Protein co-expression` | Stage-1 score from CPTAC (breast, ovarian) + Lapek et al. breast cell-line proteomics. |
| `evidence: Co-dependence` | Stage-1 score from DepMap CRISPR co-essentiality (correlated fitness profiles), global + 7 tissues. |
| `evidence: Sequence similarity` | Stage-1 score from HumanNet v1 (domain co-occurrence + orthologous interactions). |

**Normalization (verified empirically):** the five evidence columns are **log-rank normalized** — `value = 1 − ln(rank)/ln(N)` with N ≈ 1.8×10⁸ (fit is exact for 4 of 5; mRNA has ceiling ties). So an evidence value is a *rank among all human protein pairs*: 0.5 ≈ top 0.0075 %, 0.3 ≈ top 0.33 %, 0.1 ≈ top 15 %. The `Integrated score` is **not** on this scale (raw stage-2 regression, rescaled to max 1.0) — the two axes are not comparable and must not share a threshold.

### What the IAS score means — for predicate choice
Because the training target is GO co-annotation (same component/process), a high IAS means the pair is **predicted to co-occur in the same biological system at a fine granularity**, not that they physically bind. Empirically: IAS ≥ ~0.7 → same stable complex; ~0.4–0.6 → same pathway/process; ~0.3 → same compartment. This is why edges are typed as *functional association*, not physical interaction (§6).

---

## 3. Filtering plan

**Goal:** a queryable network — not a 1.85 M-edge hairball (at the full file, a median node reaches 94 % of the graph in two hops), and not an archival mirror (that already exists on NDEx). **Every protein is retained (no orphan nodes); disconnected islands are permitted.**

### Rule (single sentence)
> Keep the **union** of (every edge with `Integrated score` ≥ 0.30) and (each protein's single highest-IAS edge).

- The IAS ≥ 0.30 core aligns with the paper's own CliXO community-detection regime ("captured the vast majority of protein associations driven by physical interaction; below this threshold... impractical run-time").
- The "each protein's strongest edge" clause is a no-op for proteins already in the core (their strongest edge is ≥ 0.30 and already kept). It fires only for proteins the threshold would strand, guaranteeing **zero orphans by construction** (every protein appears in ≥ 1 row, so every protein has a strongest edge).
- **Islands are allowed.** No cross-component bridging is performed. (A fully-connected variant is possible but requires sub-0.2 bridge edges and drops 34 proteins that are unreachable in the source at any threshold; rejected in favor of retaining all proteins. That variant is nonetheless materialized as `nest/ias_network_connected.tsv` for reference — see §10.)

### Resulting network (verified) — `nest/ias_network_no_orphans.tsv`
| | |
|---|---|
| Edges | **209,996** (204,768 core + 5,228 backbone) |
| Proteins | **16,840** (all) — 0 orphans |
| Components | 191 — giant of 16,328 (97.0 %); 512 proteins off the giant, mostly paralog dyads (PSG*, PRAMEF*, KRTAP*, TFF1–TFF2, …) |
| Degree | min 1, median 3, p95 137, max 4,764 |
| Backbone-edge IAS | min 0.181, median 0.254, max 0.299 (317 below 0.20) |

`edge_role` ∈ {`core`, `backbone`} is added as the 9th column so the pure IAS ≥ 0.30 graph is one filter away and backbone edges (kept for connectivity, IAS as low as 0.181) are never mistaken for complex-strength edges.

**Parameterization:** the IAS floor (0.30), the backbone rule (on/off), and an optional evidence floor are **build parameters**, not hardcoded — so the full >0.18 file or a 0.25 cut can be regenerated with a flag. This file is the chosen input to the CX2 builder (§4, §10).

---

## 4. Output network model

Implemented in [nest/build_cx2_network.py](nest/build_cx2_network.py) → [nest/IAS_network.cx2](nest/IAS_network.cx2) (62 MB). A round-trip test reconstructs every source row from the CX2 and diffs against `ias_network_no_orphans.tsv`: **edge set identical, 0 value mismatches, all symbols preserved** — no information loss.

### Network attributes
The CX2 `networkAttributes` carry the network-level metadata. `author`, `disease`, and `organism` are lifted from the authors' NDEx deposit (UUID `60112105-f853-11e9-bb65-0ac135e8bacf`) for provenance; the rest describe this filtered build.

| attribute | value |
|---|---|
| `name` | IAS integrated protein-association network (NeST / Zheng et al. 2021) |
| `description` | filter rule + node/edge model (this build) |
| `version` | 1.0 |
| `author` | Fan Zheng |
| `disease` | cancer |
| `organism` | Human, 9606, Homo sapiens |
| `reference` | Zheng et al., Science 374:eabf3067 (2021). doi:10.1126/science.abf3067 |
| `@context` | serialized prefix map (§8) |

(The NDEx deposit is a display-only 100K-edge subsample, **not** our source — see §1/§10 notes; only these provenance fields are borrowed from it.)

### Visual style
The CX2 carries a `visualProperties` aspect so NDEx/Cytoscape renders it the way the authors' resource does. The style is extracted verbatim from the NDEx 100K-edge display network into [nest/ias_visual_style.json](nest/ias_visual_style.json) and applied by the builder (`--style`, on by default). Key elements: black background, ellipse nodes with pass-through `name` labels, and — the data-driven part — `EDGE_LINE_COLOR` as a **continuous gradient on the integrated score** (gray at 0.18 → orange → yellow at ~0.97).

Because our edges use snake_case attribute names, the builder remaps the style's attribute references on load (`COLUMN_REMAP`): the edge-color mapping's `"Integrated score"` → `"integrated_score"`. Node label maps on `"name"` (unchanged). `visualEditorProperties` (layout view state, tied to the 100K network's coordinates) is intentionally **not** copied — our nodes carry no coordinates, so NDEx/Cytoscape applies a fresh layout.

### Node keying — one node per **gene symbol** (16,840 nodes)
Nodes are keyed on the **gene symbol**, not the UniProt accession. This is deliberate:
- keeps the simple graph the source guarantees (one edge per row); keying on accession would merge the 61 colliding symbols (histone clusters, paralog pairs) onto shared nodes and collapse their incident edges into parallel edges (see [SYMBOL_TO_PROTEIN_MAPPING.md](SYMBOL_TO_PROTEIN_MAPPING.md) §6);
- loses no information — every distinct symbol survives as its own node, with the UniProt accession attached as `represents`.

**CX node id** = an integer counter. Scanning edges in file order, the first time a symbol is seen it is assigned the next integer and the counter increments. Node ids therefore run `0 … 16839` in first-seen order. Edge ids continue after the node ids (`16840 … 226835`), matching the NDEx non-overlapping-id convention.

| CX2 node attribute | value | notes |
|---|---|---|
| `id` | integer counter | 0-based, first-seen order; unique per symbol |
| `name` (alias `n`) | HGNC symbol | e.g. `MCM2` — unique, one node per symbol |
| `represents` (alias `r`) | identifier CURIE | `uniprot:<acc>` (16,828) or `hgnc:<id>` for the 12 non-protein symbols — see §7 |
| `type` | `protein` \| `gene` | `gene` for the 12 non-protein symbols; else `protein` (NCI-PID convention) |

No `alias` attribute is emitted. Secondary/isoform UniProt accessions are the authority of UniProt itself and are left there rather than duplicated onto the node (avoids drift).

### Edges — one per retained row (§3)
Columns carried onto each edge (CX2 edge attributes), and their intended RDF mapping (§6). All six numeric source columns are carried verbatim, so no data is dropped:

| CX2 edge attribute | source column | type |
|---|---|---|
| `interaction` (alias `i`) | (constant `"interacts with"`) | string — the predicate label (RO:0002434) |
| `integrated_score` | `Integrated score` | double |
| `physical_evidence` | `evidence: Physical` | double |
| `mrna_coexpression_evidence` | `evidence: mRNA co-expression` | double |
| `protein_coexpression_evidence` | `evidence: Protein co-expression` | double |
| `codependence_evidence` | `evidence: Co-dependence` | double |
| `sequence_similarity_evidence` | `evidence: Sequence similarity` | double |
| `edge_role` | (computed) | string — `core` \| `backbone` |

Edges carry `s`/`t` (source/target node ids) but the network is **undirected** — direction is not meaningful.

---

## 5. Ontology terms used (verified against OLS, July–August 2026)

| Term | Label | Role |
|---|---|---|
| `biolink:interacts_with` | interacts with | edge predicate |
| `SIO:010043` | protein | RDF class of a node typed `protein` in the CX2 (§4) |
| `SIO:010035` | gene | RDF class of the 12 nodes typed `gene` (§7) |

**Why SIO and not `biolink:Protein`.** Everything else here is Biolink-first, but node
typing deliberately is not: the NCI-PID adapter already emits `SIO:010043` for proteins,
and the two graphs are meant to join on protein IRIs. Typing the same `uniprot:` IRI as
`SIO:010043` in one graph and `biolink:Protein` in the other would make a merged store
inconsistent for no benefit. Node typing follows the existing convention;
relationships follow Biolink.

**Why the general Biolink slot.** Biolink's own documentation says to prefer a more
specific child predicate, and we deliberately do not: the children are
`physically_interacts_with`, `genetically_interacts_with` and
`pharmacologically_interacts_with`, none of which describes a score trained to predict
GO co-annotation (§2). Using a child would assert a mechanism the IAS score does not
support. Note `biolink:interacts_with` maps to `SEMMEDDB:INTERACTS_WITH`, **not** to
`RO:0002434` — this is a change of term, not a relabel.

**Rejected / superseded:**
- `RO:0002436` "molecularly interacts with" — its definition is *direct physical binding*, which overstates an IAS edge.
- `RO:0002434` "interacts with" — the earlier choice, superseded by `biolink:interacts_with` for consistency with the Biolink-first modelling used across the NeST hierarchy.
- `RO:0002558` "has evidence" and the four `ECO:*` evidence classes — no longer used; the per-evidence scores are not exported (§6b).

---

## 6. Edge → ontology mapping

**(a) The relationship** → the predicate `biolink:interacts_with` (§5).

> ### ⚠️ One triple per edge — symmetry is NOT materialized
>
> `biolink:interacts_with` is declared **symmetric**, which matches the source: the IAS
> network is undirected and the `s`/`t` orientation on a CX2 edge is an artifact of the
> file format, not a claim (§4).
>
> We emit **one triple per edge** (209,996), in the source's `s`→`t` order. The reverse
> direction is *entailed* by the predicate's symmetry but is **not written to the graph**.
>
> **Consequence for consumers:** a query that does not perform OWL reasoning will see
> each interaction from one side only. `?x biolink:interacts_with uniprot:P04264` returns
> roughly half of P04264's true partners — the half where P04264 happened to be the CX2
> target. **Any query over this graph must match both directions**, e.g.
>
> ```sparql
> { ?a biolink:interacts_with ?b } UNION { ?b biolink:interacts_with ?a }
> ```
> or, in property-path form: `?a ^biolink:interacts_with|biolink:interacts_with ?b`.
>
> The alternative — materializing both directions (419,992 triples) — was considered and
> rejected as redundant. Revisit that decision if the graph is published to an endpoint
> where consumers cannot be relied on to write symmetric queries.

**(b) The scores** → only the **`Integrated score`** is exported, as a minted
`iasv:integratedAssociationStringency` data property on the reified statement. The five
per-evidence columns (`evidence: Physical`, `… mRNA co-expression`, `… Protein
co-expression`, `… Co-dependence`, `… Sequence similarity`) are **not exported**.

Rationale and cost: the evidence columns average **4.97 non-zero values per edge**, so
ECO-typed evidence resources would add ≈ 2.1 M triples — roughly 60 % of the entire
graph — for provenance detail that the source TSV retains anyway.

> **What this loses.** An exported edge asserts "interacts with, score 0.79" with no
> indication of *why*. The ECO anchoring that distinguished a physically-supported pair
> from a co-expression-supported one is gone from the published graph. This is a one-way
> door for downstream consumers; the data remains in
> `ias_network_no_orphans.tsv` and can be re-exported if needed.

**(c) `edge_role`** has no ontology term (build artifact). Emit
`iasv:retainedForConnectivity true` on the **5,228 backbone edges only** (not on the
204,768 core edges), so the pure IAS ≥ 0.30 graph is one filter clause away and a 0.19
backbone edge never reads as a complex-strength edge.

### Reified RDF shape
`rdf:Statement` is used here rather than `biolink:Association` (which the NeST hierarchy
uses): every interaction statement carries the same shape and provenance, so
`biolink:Association`'s required `knowledge_level` and `agent_type` slots would add
≈ 420 K triples of identical boilerplate across 209,996 statements without adding
information.

### Minted vocabulary

Proto-OKN requires `rdf:type rdfs:Class` on every class and `rdfs:domain`/`rdfs:range` on
every property. The IAS half mints two properties (node classes reuse SIO, §5):

```turtle
iasv:integratedAssociationStringency a rdf:Property, owl:DatatypeProperty ;
    rdfs:label   "integrated association stringency" ;
    rdfs:comment "The IAS score: output of the second-stage random forest trained to predict
                  Resnik semantic similarity over GO Biological-Process and Cellular-Component.
                  A granularity/stringency measure of shared-system membership — NOT a
                  probability, p-value, or binding score. Range in the source 0.181-1.000." ;
    rdfs:domain  rdf:Statement ;
    rdfs:range   xsd:double .

iasv:retainedForConnectivity a rdf:Property, owl:DatatypeProperty ;
    rdfs:label   "retained for connectivity" ;
    rdfs:comment "True on an edge kept only because it is one of its proteins' single
                  highest-scoring edge, i.e. below the IAS >= 0.30 core threshold (as low as
                  0.181). Emitted only where true. Filter these out to recover the pure
                  IAS >= 0.30 network." ;
    rdfs:domain  rdf:Statement ;
    rdfs:range   xsd:boolean .
```

Statement IRIs are `nest:e<cx2EdgeId>` — see §8.

```turtle
uniprot:P02452 biolink:interacts_with uniprot:P08123 .   # COL1A1 - COL1A2, one direction only

nest:e72942 a rdf:Statement ;
    rdf:subject   uniprot:P02452 ;                  # COL1A1
    rdf:predicate biolink:interacts_with ;
    rdf:object    uniprot:P08123 ;                  # COL1A2
    iasv:integratedAssociationStringency 0.749 .
```

---

## 7. Node identifier strategy

**OKN recommendation** (https://registry.okn.us/book/biomedical-identifiers/): *"Prefer UniProt protein IDs (`http://purl.uniprot.org/uniprot/$1`)."* This matches the existing NCI-PID KG (`uniprot:` IRIs), so the two graphs join on protein IRIs.

Data S1 identifies proteins by **HGNC symbol**, so each symbol is resolved to a CURIE. **Implemented and run** — full method, provenance, and reproducibility in [SYMBOL_TO_PROTEIN_MAPPING.md](SYMBOL_TO_PROTEIN_MAPPING.md); map file [nest/symbol_curie_map.tsv](nest/symbol_curie_map.tsv).

**Result (verified, 16,840 symbols):**

| `represents` | count | notes |
|---|---:|---|
| `uniprot:<accession>` | **16,828 (99.93 %)** | HGNC → UniProt, with a UniProt-REST fallback for HGNC's blank rows |
| `hgnc:<numeric id>` | **12 (0.07 %)** | symbols with **no protein product** (pseudogenes, ncRNA, withdrawn/duplicate loci); keep a stable HGNC gene identifier |

- **Tie-break** for the 43 symbols with multiple accessions: first listed (HGNC lists reviewed Swiss-Prot first → favors the reviewed canonical). Secondary accessions are not carried onto the node.
- **The 12 non-protein symbols keep an HGNC gene identifier** (`hgnc:372`, `hgnc:51830`, …) rather than being force-mapped or dropped. The numeric HGNC id is stable across the renames/withdrawals that made them proteinless. These nodes are typed `gene` (not `protein`). Provenance: [nest/unmapped_symbols_hgnc_status.tsv](nest/unmapped_symbols_hgnc_status.tsv).
- **Collisions:** 61 symbols share an accession with another (histone clusters, tandem paralogs, legacy aliases). This is why nodes are keyed on symbol, not accession (§4).

> **⚠️ The collision returns at the RDF stage — and produces self-loops.**
> Keying CX2 nodes on symbol avoids merging collided accessions *in the CX2*, but RDF IRIs
> are minted from `represents`, i.e. the accession. Measured on the current build:
> **35 accessions are shared by 96 distinct symbols** (all 13 `HIST1H4*` genes resolve to
> `uniprot:P62805`). Two consequences:
>
> 1. **40 edges collapse to self-loops** — `PRH1–PRH2` are distinct genes both resolving to
>    `uniprot:P02810`, so the edge would assert `uniprot:P02810 biolink:interacts_with
>    uniprot:P02810`. A protein does not interact with itself. **These 40 edges are
>    dropped**, matching the NCI-PID adapter, which already discards self-loops. Emitted
>    interactions are therefore **209,956**, not 209,996.
> 2. **Collided proteins carry several `rdfs:label` values** — `uniprot:P62805` gets 13, one
>    per histone symbol. This is legal RDF (a resource may have multiple labels) and is left
>    as-is: the symbols are genuinely all names for that protein product.
>
> A further ~200 interaction triples are duplicates after collapse and merge naturally, as
> RDF is a set. Dropping the self-loops is the only place information is lost.

> Note: the paper's "proteins" are gene-level (protein-coding gene symbols). Protein-mapped nodes are typed `protein` on `uniprot:` IRIs to stay consistent with NCI-PID; the OKN page separately recommends Entrez `geneid:` for gene-level nodes — switching the 12 gene-fallback nodes from `hgnc:` to `geneid:` is a one-line change if preferred.

---

## 8. `@context` prefixes (CX2)

`@context` is **not** part of the formal CX2 v2 specification; it is the **NDEx convention** the `bio-cx2-to-rdf` converter reads (`networkAttributes.@context`). It is stored as a **`networkAttributes` entry** whose value is a **serialized JSON string** (the converter does `JSON.parse(networkAttributes['@context'])`) mapping `prefix → base IRI`. Node attribute values reference prefixes as CURIEs (e.g. `represents = "uniprot:P49736"`). Prefixes are canonicalized against the vendored Bioregistry snapshot at RDF-conversion time.

The `@context` only needs the prefixes that appear in **node/edge data** — i.e. the `represents` identifier prefixes. Ontology prefixes (`RO`, `ECO`, `okn`) are introduced at the RDF stage, not in the CX2 file. Actual `@context` written by [nest/build_cx2_network.py](nest/build_cx2_network.py):

```json
{
  "uniprot":     "http://purl.uniprot.org/uniprot/",
  "hgnc":        "http://identifiers.org/hgnc/",
  "hgnc.symbol": "http://identifiers.org/hgnc.symbol/"
}
```

- `uniprot` is the Bioregistry-canonical stem (also in the converter's vendored snapshot).
- `hgnc` / `hgnc.symbol` are **not** in the vendored snapshot, so the converter keeps these `@context` values as-is. The `hgnc` base (`http://identifiers.org/hgnc/`) is a reasonable placeholder — **review before publishing RDF**; adjust here and/or add `hgnc` to the Bioregistry snapshot if a different canonical IRI is wanted. `hgnc.symbol` is declared for the last-resort fallback only (not currently used — all 16,840 resolve to `uniprot:` or `hgnc:`).

RDF-stage prefixes (assigned by the adapter, not the CX2 file):

| prefix | IRI | holds |
|---|---|---|
| `biolink` | `https://w3id.org/biolink/vocab/` | the edge predicate (§5) |
| `SIO` | `http://semanticscience.org/resource/SIO_` | the protein/gene node class (§5) |
| `iasv` | `https://www.ndexbio.org/vocab/ias/` | IAS-specific minted terms (`integratedAssociationStringency`, `retainedForConnectivity`) |
| `nest` | `https://www.ndexbio.org/identifiers/` | **all** minted entity IRIs — NeST systems, associations, and IAS statements |

There is **one** entity prefix, `nest:`, shared with the hierarchy — no separate `ias:`
prefix (it expanded to the same IRI, which was redundant). `RO:` and `ECO:` are no longer
needed (§5).

The `okn:`/`http://example.org/okn/` placeholder is **retired**. Proto-OKN publishes no
namespace for contributors — each graph must use one it owns — so minted terms live under
`https://www.ndexbio.org/vocab/` and minted entities under
`https://www.ndexbio.org/identifiers/`.

### Statement IRIs — `nest:e<cx2EdgeId>`

An IAS reified statement takes the local name `e` + the edge's CX2 id, e.g. edge `72942`
→ `nest:e72942`.

**Collision-free (verified).** Across the whole flat namespace — 395 system locals, 726
association locals, 209,996 statement locals = 211,117 names — there are **zero
collisions** and no name needs Turtle escaping. System and association locals all begin
`NEST`, so they cannot collide with `e<digits>`. CX2 edge ids are unique and disjoint from
node ids (nodes `0…16839`, edges `16840…226835`).

> **⚠️ Not stable across rebuilds — the graph must be replaced wholesale.**
> `build_cx2_network.py` assigns node ids as a first-seen counter over the edge list and
> continues that counter for edge ids, so both depend on the entire edge set. Re-running
> with a different IAS floor (§3 — an explicit build parameter) changes **every** id:
> verified by re-filtering, `COL1A1–COL1A2` moved `e72942 → e4265`, and 100 % of edge ids
> changed.
>
> This is accepted: statement IRIs are reached by query (`?s rdf:subject uniprot:P02452`),
> never by direct lookup, so no consumer depends on the value. The consequence is that a
> new build must **replace** the published graph, not be merged into it — loading v2
> alongside v1 would leave both sets of statements under different IRIs. The dataset
> `pav:version` (§11) identifies which build a file came from.
>
> If individual statements ever need durable identity (e.g. third-party annotation),
> switch to a content-addressed local name derived from the sorted accession pair
> (`e-P02452-P08123`), which is equally collision-free and survives re-filtering.

---

## 9. Decisions

### Resolved (reflected in the CX2 build)
1. **Filter = IAS ≥ 0.30 + each protein's strongest edge; islands allowed, no orphans.** ✅
2. **Node keying = gene symbol** (not accession); id = first-seen integer counter; `name` = symbol; `represents` = CURIE. ✅ (§4)
3. **Symbol→identifier resolution** run: 16,828 `uniprot:` + 12 `hgnc:` gene ids. ✅ (§7, [SYMBOL_TO_PROTEIN_MAPPING.md](SYMBOL_TO_PROTEIN_MAPPING.md))
4. **The 12 non-protein symbols keep an HGNC gene identifier**, typed `gene`. ✅
5. **All 16,840 proteins emitted** (including the 512 island / paralog-dyad proteins). ✅
6. **CX2 edge predicate label = `"interacts with"`** (a display label in the CX2; the RDF predicate is `biolink:interacts_with`, §5). ✅
7. **Network metadata** — `author`/`disease`/`organism` borrowed from the NDEx deposit; source of truth remains Data S1, not the deposit's 100K subsample. ✅ (§4)

### Resolved (RDF stage — decided 2026-08-03, not yet built)
8. **RDF predicate = `biolink:interacts_with`**, superseding `RO:0002434`; the general slot is used deliberately (§5). ✅
9. **One triple per edge**; symmetry is not materialized — consumers must query both directions (§6a). ✅
10. **Only `Integrated score` is exported**; the five per-evidence columns and their ECO typing are dropped (§6b). ✅
11. **`edge_role`** → `iasv:retainedForConnectivity true` on the 5,228 backbone edges only (§6c). ✅
12. **Reification via `rdf:Statement`**, not `biolink:Association` (§6). ✅
13. **Namespaces** — `https://www.ndexbio.org/vocab/…` for terms, `…/identifiers/` for entities; the `okn:` placeholder is retired (§8). ✅

14. **The 12 non-protein symbols stay on `hgnc:`** — not switched to Entrez `geneid:`. 6 of the 12 (AKAP2, CRIPAK, GVQW1, OCLM, SPHAR, U2AF1L5) have **no Entrez id at all**, so a switch would leave them unidentified; 10 of the 12 are deprecated loci anyway. Bioregistry lists no `rdf_uri_format` for `hgnc` (its canonical is a genenames.org web page), so the `@context` value `http://identifiers.org/hgnc/` stands as a deliberate choice with no authoritative alternative. ✅ (§7, §8)
15. **NDEx network IRIs use the Bioregistry-registered form** `https://www.ndexbio.org/viewer/networks/$1` (§8, §11). ✅
16. **Output = a single Turtle file** (~1.3 M triples); the converter needs streaming output. ✅
17. **Provenance = dataset-level** (§11); no `dcterms:license` — deliberately out of scope. ✅
18. **Node typing stays `SIO:010043`/`SIO:010035`**, matching NCI-PID, so merged stores type the same `uniprot:` IRI consistently; only *relationships* are Biolink-first (§5). ✅
19. **One entity prefix `nest:`** = `https://www.ndexbio.org/identifiers/`, shared with the hierarchy; the redundant `ias:` prefix is dropped (§8). ✅
20. **Statement IRIs = `nest:e<cx2EdgeId>`** — verified collision-free across all 211,117 minted locals. Not stable across re-filters (100 % of ids move); accepted because statements are reached by query, not lookup (§8). ✅
21. **Self-loops from accession collision are dropped** — 40 edges, where both endpoints' symbols resolve to one UniProt accession (§7). ✅
22. **Release policy: always replace the published graph wholesale, never merge.** Minted IRIs are build-scoped, and raising the size cutoff or IAS floor *removes* triples, which an RDF merge cannot express. `pav:version` must be incremented every release (§11). ✅

### Open (RDF stage)
1. **The two NDEx deposits are `UNLISTED` and owned by `cjtest`** (§11). The UUIDs themselves are settled and verified, but provenance IRIs that do not resolve for third parties are worse than none. Make both **PUBLIC** under a durable owner before publishing RDF.
2. **Bioregistry `ndex` record has no `rdf_uri_format`** (only a `uri_format` pointing at the viewer page), so the converter's automatic canonicalization will not pick it up and the IRI stem must be set deliberately. **Action:** contribute an `rdf_uri_format` to the Bioregistry `ndex` record — NDEx is our own resource, so this is ours to fix. Once merged and pulled into the vendored snapshot (`npm run refresh:bioregistry`), the manual override can be removed and every downstream consumer converges on the same IRI.
3. **`merge_cx2.py` writes the old NDEx stem.** Its `@context` binds `ndex → https://www.ndexbio.org/v3/networks/`; change it to the viewer form and regenerate the merged NCI-PID networks, otherwise two IRI forms for NDEx networks coexist in one graph.
4. **RDF adapter:** implement a NeST/IAS adapter in `bio-cx2-to-rdf/src/adapters/` (detect this network; map edges per §6). Not started.

---

## 10. Pipeline artifacts (in `nest/`)

| file | kind | description |
|---|---|---|
| `science.abf3067_data_s1_to_s3/abf3067_Data_S1.tsv` | input | source IAS edge list (1,848,498 rows) |
| `map_symbols_to_uniprot.py` | script | exploratory symbol→UniProt mapping + coverage/collision report |
| `build_symbol_curie_map.py` | script | **canonical** symbol→CURIE builder (HGNC + UniProt-REST fallback) |
| `symbol_curie_map.tsv` | output | symbol → `uniprot:`/`hgnc:` CURIE, id_type, route |
| `unmapped_symbols_hgnc_status.tsv` | output | provenance for the 12 non-protein symbols |
| `uniprot_fallback_cache.json` | cache | UniProt REST results (commit for offline/deterministic re-runs) |
| `hgnc_complete_set.txt`, `hgnc_withdrawn.txt` | input | HGNC snapshots (record download date on refresh) |
| `filter_ias_network.py` | script | Data S1 → filtered edge list (§3 rule; adds `edge_role`) |
| `ias_network_no_orphans.tsv` | output | **chosen** filtered edge list (209,996 edges; §3) |
| `ias_network_connected.tsv` | output | reference fully-connected variant (drops 34 unreachable proteins) |
| `ias_visual_style.json` | input | visual style extracted from the NDEx 100K display network; applied by the builder |
| `build_cx2_network.py` | script | filtered TSV + symbol map + style → CX2 |
| `IAS_network.cx2` | output | **the CX2 network** (16,840 nodes, 209,996 edges) with visual style |

---

## 11. Provenance

> **Scope: the whole export, not just IAS.** Provenance covers the combined Turtle file —
> the NeST hierarchy and the IAS network are emitted together. This section lives here
> because it is the doc that is currently accurate; hoist it to a shared design doc when
> [NEST_HIERARCHY_DATASET.md](NEST_HIERARCHY_DATASET.md) is written.

### Granularity: dataset-level, not per-entity

One `void:Dataset` node describes the export. Provenance is **not** attached to individual
systems, proteins, or statements: every entity in the file has the same two sources, so
per-entity `prov:wasDerivedFrom` would add 17,000+ triples restating one fact.

> **Limitation of the single-Turtle-file decision.** Turtle cannot say *which* triples came
> from which source — that requires named graphs. So the hierarchy and IAS halves are
> attributed jointly, at file level, not separately. If per-source attribution is later
> needed, switch the output to **TriG** (still one file; N3.js already writes it) and put
> each source's triples in its own named graph. Recorded here so the limitation is a known
> trade rather than a surprise.

### Namespaces

| prefix | IRI |
|---|---|
| `void` | `http://rdfs.org/ns/void#` |
| `prov` | `http://www.w3.org/ns/prov#` |
| `dcterms` | `http://purl.org/dc/terms/` |
| `pav` | `http://purl.org/pav/` |
| `ndex` | `https://www.ndexbio.org/viewer/networks/` — the Bioregistry-registered form (§9 open item 2) |

### The block

```turtle
<https://www.ndexbio.org/identifiers/nest-kg> a void:Dataset , prov:Entity ;
    dcterms:title       "NeST cancer systems map with IAS protein-association network" ;
    dcterms:description "NeST 1.0 hierarchy of 395 protein systems under mutational
                         selection across 13 cancer types, with the filtered IAS
                         protein-association network its members are drawn from." ;
    dcterms:publisher   <https://www.ndexbio.org> ;
    dcterms:source      <https://doi.org/10.1126/science.abf3067> ;
    dcterms:created     "YYYY-MM-DD"^^xsd:date ;
    pav:version         "1.0" ;
    prov:wasDerivedFrom ndex:4f9210a1-8797-11f1-857e-005056ae3c32 ,   # NeST hierarchy (HCX)
                        ndex:4731187a-8796-11f1-857e-005056ae3c32 ;  # IAS network
    prov:wasGeneratedBy [ a prov:Activity ;
        prov:wasAssociatedWith <https://github.com/ndexbio/proto-okn> ;
        pav:version "bio-cx2-to-rdf <version>" ] .
```

- `dcterms:source` uses the **DOI**, per the OKN recommendation to prefer DOIs for publications.
- `prov:wasDerivedFrom` cites the **NDEx deposits** — the artifacts a consumer can actually
  re-download and diff against — while the DOI cites the science.
- `prov:wasGeneratedBy` records the converter and its version, so a given file can be traced
  to the code that produced it.

### Release policy — always replace, never merge

**Each build supersedes the previous one in full.** A new release replaces the published
graph wholesale; it is never merged into, or diffed against, an existing load.

Why this is a policy and not just a side effect:

- **Minted IRIs are build-scoped.** Statement IRIs (`nest:e<cx2EdgeId>`, §8) move when the
  IAS floor changes — 100 % of them, verified. Merging v2 into a store still holding v1
  leaves both sets of statements, under different IRIs, describing the same interactions.
- **Suppressed content is invisible to a merge.** The hierarchy emits `has_member` and
  associations only for systems below the size cutoff, and the IAS build drops edges below
  the IAS floor. Raising either threshold in a new build *removes* triples — which a merge
  cannot express, since RDF merges only add.

Consumers therefore need `pav:version` on the dataset node to tell builds apart, and it
must be incremented on every release. When updating the graph in the OKN landing zone, use
the full-replacement path rather than an incremental update.

### NDEx deposits (verified 2026-08-03 against the NDEx API)

| UUID | network | nodes / edges |
|---|---|---|
| `4731187a-8796-11f1-857e-005056ae3c32` | IAS integrated protein-association network (NeST / Zheng et al. 2021) | 16,840 / 209,996 |
| `4f9210a1-8797-11f1-857e-005056ae3c32` | NeST Map - Main Model (Hiview version) | 395 / 466 |

Both node/edge counts match the CX2 artifacts in §10 exactly. This also resolves the
earlier UUID conflict: `4731187a…` (the value carried in `NeST_hierarchy_HCX.cx2`) is the
IAS network; the previously documented `e3bb3a6d-878e-11f1-857e-005056ae3c32` was wrong and
has been corrected in [NEST_HIERARCHY_DATASET.md](NEST_HIERARCHY_DATASET.md) and
`nest/build_hcx_hierarchy.py`.

> **⚠️ Both networks are `UNLISTED` and owned by the account `cjtest`.** Citing them as
> `prov:wasDerivedFrom` in published RDF means the provenance IRIs will not resolve for
> anyone else. Before publishing, both must be made **PUBLIC** and moved to a durable
> owner account. See §9 open item 1.

---

**Last updated:** 2026-08-03
**Reviewer:** (pending)
