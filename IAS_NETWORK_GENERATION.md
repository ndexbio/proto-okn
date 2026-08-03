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

## 5. Ontology terms used (all verified against OLS/ECO, July 2026)

| Term | Label | Role |
|---|---|---|
| `RO:0002434` | interacts with | edge predicate (generic functional association) |
| `RO:0002558` | has evidence | edge → evidence resource |
| `ECO:0000021` | physical interaction evidence | type of the physical-evidence resource |
| `ECO:0000044` | sequence similarity evidence | type of the sequence-similarity resource |
| `ECO:0000011` | genetic interaction evidence | type of the co-dependence resource *(approximate — see §6)* |
| `ECO:0000008` | expression pattern evidence | type of both co-expression resources |

Rejected: `RO:0002436` "molecularly interacts with" (its definition is *direct physical binding* — overstates an IAS edge).

---

## 6. Edge → ontology mapping

Two kinds of edge attribute, mapped differently:

**(a) The relationship** → the predicate `RO:0002434` **interacts with**. Chosen for its deliberately broad definition ("processes executed by the two entities are causally connected"), consistent with IAS being a functional-association / shared-system score rather than a binding assertion (§2). Biolink alternative if preferred: `biolink:associated_with`.

**(b) The scores** → a number is not a relation, so scores are **not** themselves ontology terms. What is anchored to an ontology is the *evidence type* each score summarizes (an ECO class). Each evidence type becomes a small evidence resource typed by its ECO class and carrying the numeric score; `RO:0002558` (has evidence) links the edge to it. The `Integrated score` and the raw scores are minted `okn:` data properties.

Caveats to preserve in the mapping (not paper over):
- **Co-dependence → ECO:0000011 is approximate.** DepMap co-essentiality is correlated *single-gene* fitness, not a classic epistasis screen. Nearest ECO anchor, flagged as such.
- **mRNA and protein co-expression share ECO:0000008.** ECO has no coexpression-specific class; the mRNA-vs-protein distinction survives only in the `okn:` property name / label.
- **`edge_role`** has no ontology term (build artifact). Emit as `okn:retainedForConnectivity` (boolean) so the pure IAS ≥ 0.30 graph is one filter clause away and a 0.19 backbone edge never reads as a complex edge.

### Reified RDF shape (illustrative)
```turtle
okn:statement_1 a rdf:Statement ;
    rdf:subject   uniprot:P49736 ;          # MCM2
    rdf:predicate RO:0002434 ;               # interacts with
    rdf:object    uniprot:P25205 ;           # MCM3
    okn:integratedAssociationStringency 0.964 ;
    okn:retainedForConnectivity false ;
    RO:0002558 [ a ECO:0000021 ; okn:score 0.688 ] ,   # physical
               [ a ECO:0000044 ; okn:score 0.580 ] ,   # sequence similarity
               [ a ECO:0000011 ; okn:score 0.223 ] ,   # co-dependence
               [ a ECO:0000008 ; okn:score 0.616 ] .   # mRNA co-expression
```
(Flat alternative: one `okn:*Score` triple per value, no evidence nodes — loses the ECO typing. The reified form is preferred precisely because it anchors the ECO terms.)

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

RDF-stage prefixes (assigned by the adapter, not the CX2 file): `RO → …/obo/RO_`, `ECO → …/obo/ECO_`, `okn → <base>`. **Open item:** the `okn:` base is a placeholder (`http://example.org/okn/` in the current converter). A real OKN base IRI must be assigned before publishing RDF.

---

## 9. Decisions

### Resolved (reflected in the CX2 build)
1. **Filter = IAS ≥ 0.30 + each protein's strongest edge; islands allowed, no orphans.** ✅
2. **Node keying = gene symbol** (not accession); id = first-seen integer counter; `name` = symbol; `represents` = CURIE. ✅ (§4)
3. **Symbol→identifier resolution** run: 16,828 `uniprot:` + 12 `hgnc:` gene ids. ✅ (§7, [SYMBOL_TO_PROTEIN_MAPPING.md](SYMBOL_TO_PROTEIN_MAPPING.md))
4. **The 12 non-protein symbols keep an HGNC gene identifier**, typed `gene`. ✅
5. **All 16,840 proteins emitted** (including the 512 island / paralog-dyad proteins). ✅
6. **CX2 edge predicate label = `"interacts with"`** (RO:0002434). ✅
7. **Network metadata** — `author`/`disease`/`organism` borrowed from the NDEx deposit; source of truth remains Data S1, not the deposit's 100K subsample. ✅ (§4)

### Open (RDF stage — not yet built)
1. **RDF predicate:** `RO:0002434` (leaning) vs `biolink:associated_with` (§6).
2. **Evidence encoding:** reified ECO-typed evidence nodes vs flat `okn:*Score` properties (§6).
3. **`okn:` base IRI:** needs a real value, not the `http://example.org/okn/` placeholder (§8).
4. **`hgnc` `@context` base:** confirm `http://identifiers.org/hgnc/` or supply a canonical IRI / add to the Bioregistry snapshot (§8).
5. **RDF adapter:** implement a NeST/IAS adapter in `bio-cx2-to-rdf/src/adapters/` (detect this network; map edges + ECO evidence). Not started.

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

**Last updated:** 2026-07-23
**Reviewer:** (pending)
