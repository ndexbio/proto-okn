# NeST Hierarchy — CX2 → RDF Design Specification

**Status:** ✅ RDF design settled (2026-08-03) · ✅ **implemented and generated** (2026-08-04)

This document specifies how the **NeST hierarchy** (395 protein systems) is converted from
CX2 to RDF for the OKN.

> **The graph exists.** [nest/nest_to_rdf.py](nest/nest_to_rdf.py) and
> [nest/nest_to_rdf.mjs](nest/nest_to_rdf.mjs) implement this specification and emit
> [nest/nest.ttl](nest/nest.ttl) — **1,318,375 triples**, hierarchy and IAS network together.
> Build instructions are in [IAS_NETWORK_GENERATION.md §0](IAS_NETWORK_GENERATION.md);
> artifacts in §10. What remains is **deposit and deployment**, not conversion (§9).

> **Scope.** The hierarchy and the IAS interaction network are **exported together into one
> Turtle file**, but are specified separately:
> - *this document* — the 395 systems, their containment, membership, and cancer associations
> - [IAS_NETWORK_GENERATION.md](IAS_NETWORK_GENERATION.md) — the 16,840 proteins and 209,996
>   interactions, **plus the shared concerns**: namespaces (§8), provenance and release
>   policy (§11)
> - [SYMBOL_TO_PROTEIN_MAPPING.md](SYMBOL_TO_PROTEIN_MAPPING.md) — HGNC symbol → `uniprot:`/`hgnc:` resolution
>
> The two halves join on protein IRIs: a system's members *are* nodes of the IAS network.

---

## 1. Dataset Overview

**Name**: NeST 1.0 hierarchical cancer systems map
**Format**: Cytoscape CX2 → HCX
**Source**: Zheng et al., *Science* 374, eabf3067 (2021), Fig. 4A / Data S3; http://ccmi.org/nest/. Local file: `nest/NeST Map - Main Model.cx2`.
**Description**: A hierarchy of **395 protein systems** ("Nested Systems in Tumors") under mutational selection across 13 cancer types, derived from the IAS network by multiscale community detection (CliXO/HiDeF) and HiSig. Nodes = protein systems (from complexes to broad processes); edges = containment (system-within-system).

### Verified source structure
- **395 nodes** (systems), **466 edges** (containment).
- **Node attributes**: `NEST ID` (e.g. `NEST:60`), `name` (`n`, identical to `NEST ID` on all 395), `Genes` (space-separated HGNC symbols), `Size`, `Size-Log`, `Annotation` (curator-assigned name), `adjusted  p-value` *(note: two spaces)* / `-log10 adjusted p-value`, `Weight`, `No. significantly mutated cancer types [(aggregate)]`, `Significantly mutated cancer types [(aggregate)]`, and per-cohort `Mutation frequency:<CODE>` for all 13 tumor types.
- **Edge attributes**: `name` (a Cytoscape label built from *stale* `Cluster…` ids), `interaction` (constant `"interacts with"` on all 466), `Tree_edge` (boolean, present on 415).
- **Containment is real mereology** (verified): for **all 466 edges** the child's gene set is a strict subset of the parent's, and child `Size` < parent `Size`. 0 violations.
- **It is a DAG, not a tree**: **62 of 395** nodes have more than one parent (54×2, 6×3, 2×4).

---

## 2. HCX conversion — linking to the IAS interaction network (implemented)

The main model is converted to **HCX** (Hierarchical CX2, spec: https://cytoscape.org/cx/cx2/hcx-specification/) so NDEx/HiView renders it as a browsable hierarchy whose systems link to nodes of the IAS interaction network.

**Script:** [nest/build_hcx_hierarchy.py](nest/build_hcx_hierarchy.py) → [nest/NeST_hierarchy_HCX.cx2](nest/NeST_hierarchy_HCX.cx2).

**The link mechanism:** NDEx preserves CX2 node ids, so IAS node id *N* (name = gene symbol) in [nest/IAS_network.cx2](nest/IAS_network.cx2) is the **same id** in the uploaded NDEx network. The converter maps each system's `Genes` symbols → those IAS node ids and stores them as `HCX::members`. **This is the link the RDF membership mapping uses (§4.4)** — not the `Genes` strings.

| level | attribute | value |
|---|---|---|
| network | `ndexSchema` | `"hierarchy_v0.1"` (required) |
| network | `HCX::modelFileCount` | `2` |
| network | `HCX::interactionNetworkUUID` | `4731187a-8796-11f1-857e-005056ae3c32` (verified 2026-08-03 against the NDEx API) |
| node | `HCX::isRoot` (boolean) | `true` on the root, `false` on the other 394 |
| node | `HCX::members` (`list_of_long`) | IAS node ids of the system's genes — **the link** |
| node | `HCX::memberNames` (`list_of_string`) | parallel gene symbols |

- **Root** = the unique node never a containment *target*; resolves to `NEST` (cx id 41341).
- **Coverage (verified both directions):** all 55,572 `HCX::members` ids resolve to a real IAS node with a matching name — **0 dangling ids, 0 id→name mismatches**. Conversely all 16,840 IAS proteins are members of *some* system, though **6,635 (39.4 %) belong to no non-root system**.
- **2,199 gene slots (2,195 distinct symbols) have no IAS node.** All but 4 are the root's full-genome padding. Only three real systems lose anything: NEST:2 (IL36G, SPAAR), NEST:8 (IL36G), NEST:29 (SPAAR).

**NDEx deposit:** `4f9210a1-8797-11f1-857e-005056ae3c32` ("NeST Map - Main Model (Hiview version)", 395/466 — verified). Currently `UNLISTED`; see [IAS_NETWORK_GENERATION.md §9](IAS_NETWORK_GENERATION.md).

---

## 3. Source attribute inventory

Every node attribute, what it actually contains (verified against the data), and its fate.

| attribute | verified meaning | fate |
|---|---|---|
| `NEST ID` | published stable id, `NEST` or `NEST:<n>`; 395 distinct | → IRI + `dcterms:identifier` |
| `name` (`n`) | identical to `NEST ID` on all 395 | dropped (redundant) |
| `Annotation` | curator-assigned name; 395 distinct, but **55 are just the NEST id** and 43 are composite prose | → `rdfs:label` only (§4.7) |
| `Genes` | space-separated HGNC symbols | not used directly — see `HCX::members` |
| `Size` | **exactly** `len(Genes)` on all 395 | → `ndexv:memberCount` |
| `Size-Log` | **exactly** `log2(Size)` | dropped — node-size visual mapping |
| `Weight` | HiSig Lasso coefficient; 394/395 non-zero (the zero is the root), median 0.37 | → `nestv:hisigWeight` on the **system node** (§4.2) |
| `adjusted  p-value` | Benjamini–Hochberg-corrected **permutation** p-value from HiSig, pan-cancer. Present on all 395; **277 are exactly 1.0**, 112 are < 0.05 | → `nestv:hisigAdjustedPValue` on the **system node** (§4.2) |
| `-log10 adjusted p-value` | **exactly** `-log10(adjusted p-value)` | dropped — display |
| `Significantly mutated cancer types` | the system's **own** per-cohort HiSig hits; 319 systems have ≥1 | → drives the per-cohort associations (§4.5a) |
| `No. significantly mutated cancer types` | **exactly** the cardinality of the above | dropped — derivable |
| `… (aggregate)` (both) | **union over the system and all its descendants** — matches 395/395 when traversing **all 466 edges**, but only 373/395 over `Tree_edge` alone | dropped — derivable via `part_of+` (§4.3) |
| `Mutation frequency:<CODE>` ×13 | fraction of tumors of that cohort with ≥1 mutation in any member gene | → `nestv:tumorsMutatedFraction`, **only for flagged cohorts** (§4.5a) |
| `HCX::isRoot` | structural | dropped — entailed by having no outgoing `part_of` |
| `HCX::members` / `HCX::memberNames` | IAS node ids / symbols | → `biolink:has_member` (§4.4) |

> **The two analyses are independent.** Pan-cancer significance and per-cohort significance
> do not agree: 225 systems have per-cohort hits but adjusted p ≥ 0.05, and 18 have
> adjusted p < 0.05 with no per-cohort hit at all. They are modelled as two association
> families (§4.5), not merged.

Edge attributes: `name` (stale `Cluster…` ids) and `interaction` (constant) are both
dropped; `Tree_edge` is dropped (§4.3). **Containment edges therefore carry no information
beyond source→target**, so nothing about them needs reifying.

---

## 4. RDF design

### 4.1 Namespaces

| prefix | IRI |
|---|---|
| `nest` | `https://www.ndexbio.org/identifiers/` — **all** minted entity IRIs |
| `ndexv` | `https://www.ndexbio.org/vocab/` — terms shared by any CX2/HCX conversion |
| `nestv` | `https://www.ndexbio.org/vocab/nest/` — NeST-specific terms |
| `biolink` | `https://w3id.org/biolink/vocab/` |
| `MONDO` | `http://purl.obolibrary.org/obo/MONDO_` |
| `ECO` | `http://purl.obolibrary.org/obo/ECO_` |
| `NCIT` | `http://purl.obolibrary.org/obo/NCIT_` |
| `SIO` | `http://semanticscience.org/resource/SIO_` |
| `uniprot` | `http://purl.uniprot.org/uniprot/` |

Rationale for the ndexbio.org bases (Proto-OKN publishes no namespace for contributors) is
in [IAS_NETWORK_GENERATION.md §8](IAS_NETWORK_GENERATION.md).

### 4.2 System nodes

**IRI:** `nest:` + `NEST ID` with `:` → `-`. So `NEST:284` → `nest:NEST-284`; the root →
`nest:NEST`. Verified: 395 distinct, Turtle-safe, no escaping, no collisions.

```turtle
nest:NEST-284 a ndexv:ProteinSystem ;
    rdfs:label         "Collagen I, III, V" ;
    dcterms:identifier "NEST:284" ;
    ndexv:memberCount        5 ;
    nestv:hisigWeight        0.65 ;
    nestv:hisigAdjustedPValue 1.0 .
```

> **Rule: node-level attributes are always emitted, for every node that has them.**
> The size cutoff (§4.6) gates only `has_member` and the associations. Scalar attributes
> that describe the system itself are never suppressed — so the 19 systems above the cutoff
> still carry their `memberCount`, weight and p-value, even though their membership and
> associations are not emitted.

`ndexv:memberCount` is emitted explicitly rather than left to `COUNT(has_member)`: `Size` is
the source-reported figure and the two differ where members are suppressed or unresolvable.

`nestv:hisigWeight` and `nestv:hisigAdjustedPValue` are the two outputs of the same
pan-cancer HiSig run, one value per system. They are node properties because they do not
vary by cohort — unlike `tumorsMutatedFraction`, which does and therefore stays on the
associations (§4.5a). Keeping them together on the node means a weight is never published
without the significance that qualifies it.

- `nestv:hisigAdjustedPValue` — all **395** nodes have a value (277 of them exactly 1.0).
- `nestv:hisigWeight` — emitted for the **394** non-zero values; **skipped for the root**, the only 0.0.

> **Why not `biolink:adjusted_p_value`.** That slot's domain is `biolink:Association`; using
> it on a `ProteinSystem` node would be a domain violation. Hence a minted property (§6),
> the same reasoning that applies to `nestv:hisigWeight`.

**All 395 nodes are emitted regardless of size.**

### 4.3 Containment → `biolink:part_of`

Child as subject, over **all 466 edges**, no reification:

```turtle
nest:NEST-284 biolink:part_of nest:NEST-217 .
```

- **Why `part_of`**: containment here is genuine mereology — child gene sets are strict subsets of parents' on all 466 edges. `biolink:subclass_of` was rejected: systems carry instance-level data (a specific p-value, per-cohort frequencies), so they are individuals, not classes.
- **`Tree_edge` is dropped.** It exists to collapse the DAG to a tree for tree/circle-packing layouts — a display concern. Note the source encoding is subtle: 343 `true` + **51 unset** together form a spanning tree (exactly one primary parent per non-root node), and 72 `false` are additional/pleiotropic containment. All 466 are real containment and all are emitted.
- **Traverse all edges, not just the tree.** The `(aggregate)` columns reconcile 395/395 over the full DAG and only 373/395 over the spanning tree — evidence the authors' own tooling treats the non-tree edges as genuine containment. A query reproducing those columns must use `part_of+` over everything.
- Inverses (`has_part`) are not emitted; they are entailed.

### 4.4 Membership → `biolink:has_member`

System as subject, resolved through `HCX::members` → the IAS node's `represents`:

```turtle
nest:NEST-284 biolink:has_member uniprot:P02452, uniprot:P08123, uniprot:P02461,
                                 uniprot:P20908, uniprot:P05997 .
```

- Resolving via `HCX::members` (the HCX-spec link) rather than the NeST-specific `Genes` string is what keeps the mechanism general to any HCX hierarchy.
- `biolink:has_member` maps exactly to `RO:0002351`, already used for gene families by the NCI-PID adapter.
- **Gated by the size cutoff (§4.6).** The root is Size 19,035 and is therefore suppressed automatically — no special-casing needed.
- **Known loss:** below the cutoff, exactly one system loses one member — NEST:29 loses `SPAAR`, which has no IAS node. Accepted rather than building a second resolution path for one protein.

### 4.5 Cancer associations

Two families, both `biolink:Association` with predicate `biolink:genetically_associated_with`
(domain/range `NamedThing`, so no domain violation — `gene_associated_with_condition` was
rejected because its domain is `Gene` and a system is not a gene).

#### (a) Per-cohort — one per significantly-mutated cancer type

**The mutation frequency is evidence *for* the assertion, not an assertion of its own.**
Frequencies for cohorts the system is *not* flagged in are dropped: a frequency is not a
finding. The root scores 1.0 in every cohort, and NEST:41 is flagged in OV at 0.455 while
*not* flagged in SKCM at 0.866 — frequency and significance are independent.

```turtle
nest:NEST-284-SKCM a biolink:Association ;
    biolink:subject             nest:NEST-284 ;
    biolink:predicate           biolink:genetically_associated_with ;
    biolink:object              MONDO:0005012 ;   # cutaneous melanoma
    nestv:tumorsMutatedFraction 0.518 ;
    biolink:knowledge_level     biolink:statistical_association ;
    biolink:agent_type          biolink:data_analysis_pipeline ;
    biolink:has_evidence        ECO:0007672 .     # computational evidence
```

IRI: `nest:<systemLocal>-<COHORT>`. Neither HiSig statistic appears here — both are
per-system and live on the node (§4.2).

#### (b) Pan-cancer HiSig selection — only where adjusted p < 0.05

```turtle
nest:NEST-48-hisig a biolink:Association ;
    biolink:subject          nest:NEST-48 ;
    biolink:predicate        biolink:genetically_associated_with ;
    biolink:object           MONDO:0004992 ;   # cancer
    biolink:knowledge_level  biolink:statistical_association ;
    biolink:agent_type       biolink:data_analysis_pipeline ;
    biolink:has_evidence     ECO:0007672 .
```

This association carries **no statistic** — it is the *assertion* that HiSig selected the
system pan-cancer; the p-value that justifies it is `nestv:hisigAdjustedPValue` on the
subject node (§4.2), where it is available for all 395 systems rather than only the
significant ones.

Emitted only for the 112 systems below p = 0.05 — asserting it for the other 283 would state
a non-finding as a positive edge. **This family is required, not optional**: 76 systems have
no flagged cohort at all, and 18 of those *are* pan-cancer significant — including
**NEST:48 "Actin cytoskeleton", the most significant system in the map (p = 3.18e-97)**,
which would otherwise have no disease link whatsoever.

### 4.6 The size cutoff — 400

All 395 nodes and all 466 `part_of` edges are always emitted. The cutoff gates **only**
`has_member` and associations.

**Why systems are not deleted:** the large systems *are* the upper structure of the DAG.
Removing them orphans 41 % of survivors and shatters the hierarchy into a forest of 151
roots; transitive rewiring recovers **zero** edges, because the orphans' ancestors are all
removed too. So the payload is filtered, not the graph.

**Why 400:** mutation frequency saturates with system size — a large system is "mutated" in
nearly every tumor and therefore discriminates nothing.

| size band | n | median mean-frequency |
|---|---:|---:|
| 0–20 | 263 | 0.119 |
| 50–100 | 32 | 0.481 |
| 200–500 | 14 | 0.787 |
| 500–1000 | 8 | **0.909** |
| 1000+ | 10 | **0.987** |

All ten systems ≥ 1000 ("Cytoplasm and extracellular space", "Ribonucleoprotein complexes", …)
are mutated in 91–100 % of tumors. 400 keeps recognizable biology (Extracellular matrix
organization at 373, Protein processing in ER at 372) while excluding the broad categories.

**The cutoff barely affects the science:** associations move 700 → 701 → 701 across cutoffs
300/400/500, because the large systems mostly have no flagged cohort anyway. It is
essentially a membership-volume knob.

### 4.7 What is deliberately dropped

| dropped | why |
|---|---|
| `Size-Log`, `-log10 adjusted p-value` | exactly derivable; display artifacts |
| `No. significantly mutated cancer types` (both) | exactly the set cardinality |
| `Significantly mutated cancer types (aggregate)` | union over descendants — recomputable via `part_of+` |
| `Tree_edge`, edge `name`, edge `interaction` | display / stale / constant (§3) |
| frequencies for non-flagged cohorts | a frequency is not a finding (§4.5a) |
| `Annotation` → GO/Reactome mapping | **attempted and rejected** — see below |
| `HCX::isRoot` | entailed structurally |

> **On `Annotation` → ontology terms.** The source CX2 contains **zero** ontology
> identifiers (0 matches for `GO:`, `R-HSA-`, `CORUM`). Deriving terms by label search
> failed verification: of 8 spot-checked OLS `exact=true` hits, only 2 were true label
> matches — "Inflammasome complex" resolved to *negative regulation of NLRP3 inflammasome
> complex assembly*. 55 of 395 Annotations are just the NEST id repeated and 43 are
> composite prose. Separately the relation was wrong: a GO *biological process* is not a
> `skos:closeMatch` for a *set of proteins*. **`Annotation` becomes `rdfs:label` and
> nothing more.** If revisited, it needs the authors' enrichment output plus anchor
> verification, not display labels.

---

## 5. Cancer type → MONDO

MONDO is the OKN-recommended disease vocabulary. All 13 TCGA cohort codes resolve; the
mapping is **generated and verified**, not hand-typed.

**Script:** [nest/map_cancer_types_to_mondo.py](nest/map_cancer_types_to_mondo.py) ·
**input:** [nest/nest_cancer_types.tsv](nest/nest_cancer_types.tsv) ·
**output:** [nest/cancer_type_mondo_map.tsv](nest/cancer_type_mondo_map.tsv)

The script searches broadly, then **verifies each candidate against a named anchor**, ranked
`override` → `oncotree_xref` → `exact_synonym` → `exact_label` → `synonym_match`, and flags
anything resolved only weakly. This matters: a plain label search gets it wrong — `LUSC`
hits *Luscan-Lumish syndrome*, `BRCA` hits *BRCA1-related cancer predisposition*, and the
correct BLCA term (`MONDO:0005611`) is invisible to label search because its alignment lives
in its synonym `BLCA` and xref `ONCOTREE:BLCA`.

| TCGA | MONDO | label | anchor |
|---|---|---|---|
| BLCA | `MONDO:0005611` | bladder transitional cell carcinoma | `ONCOTREE:BLCA` |
| BRCA | `MONDO:0006256` | invasive breast carcinoma | `ONCOTREE:BRCA` |
| COAD | `MONDO:0002271` | colon adenocarcinoma | `ONCOTREE:COAD` |
| GBM | `MONDO:0018177` | glioblastoma | synonym `GBM` |
| HNSC | `MONDO:0010150` | head and neck squamous cell carcinoma | `ONCOTREE:HNSC` |
| KIRC | `MONDO:0005005` | clear cell renal carcinoma | exact label |
| LIHC | `MONDO:0007256` | hepatocellular carcinoma | exact label |
| LUAD | `MONDO:0005061` | lung adenocarcinoma | `ONCOTREE:LUAD` |
| LUSC | `MONDO:0005097` | squamous cell lung carcinoma | `ONCOTREE:LUSC` |
| OV | `MONDO:0006046` | ovarian serous cystadenocarcinoma | curator override |
| SKCM | `MONDO:0005012` | cutaneous melanoma | `ONCOTREE:SKCM` |
| STAD | `MONDO:0005036` | gastric adenocarcinoma | `ONCOTREE:STAD` |
| UCEC | `MONDO:0000553` | uterine corpus endometrial carcinoma | curator override |

13/13 resolved, 0 flagged for review. The two overrides carry written reasons in the data
file. `--check-cx2` re-derives the cohort list from the hierarchy and confirms the data file
covers it exactly; `--offline` reproduces the output byte-identically from the committed
cache. Pan-cancer uses `MONDO:0004992` (cancer).

---

## 6. Minted vocabulary

Proto-OKN requires `rdf:type rdfs:Class` on every class and `rdfs:domain`/`rdfs:range` on
every property. **Drafted below; not yet reviewed.**

```turtle
ndexv:ProteinSystem a rdfs:Class, owl:Class ;
    rdfs:label      "protein system" ;
    rdfs:comment    "A set of proteins identified as functioning together, derived by
                     multiscale community detection over a protein-association network.
                     Spans scales from protein complexes to broad cellular processes." ;
    rdfs:subClassOf biolink:BiologicalEntity .

ndexv:memberCount a rdf:Property, owl:DatatypeProperty ;
    rdfs:label         "member count" ;
    rdfs:comment       "Number of distinct member proteins in the system as reported by the
                        source (CX2 `Size`). NOT necessarily equal to the number of emitted
                        biolink:has_member triples: membership is suppressed above the size
                        cutoff, and a few members have no node in the interaction network." ;
    rdfs:subPropertyOf biolink:has_count ;
    rdfs:domain        ndexv:ProteinSystem ;
    rdfs:range         xsd:nonNegativeInteger .

nestv:tumorsMutatedFraction a rdf:Property, owl:DatatypeProperty ;
    rdfs:label         "tumors mutated fraction" ;
    rdfs:comment       "Fraction of tumors in the cohort carrying at least one somatic
                        mutation in any member gene of the system. Numerator: patients with
                        >=1 mutated member. Denominator: patients in the cohort." ;
    rdfs:subPropertyOf biolink:has_quotient ;
    rdfs:domain        biolink:Association ;
    rdfs:range         xsd:double .

nestv:hisigWeight a rdf:Property, owl:DatatypeProperty ;
    rdfs:label    "HiSig weight" ;
    rdfs:comment  "Lasso coefficient assigned to the system by HiSig — how much of the
                   observed mutational signal the model attributes to it. One value per
                   system, from the pan-cancer run; it does not vary by cohort, hence a
                   node property rather than an association slot. NOT a significance
                   measure: read it together with nestv:hisigAdjustedPValue, which is
                   emitted on the same node for every system." ;
    rdfs:seeAlso  STATO:0000565 ;   # regression coefficient — the kind of quantity this is
    rdfs:domain   ndexv:ProteinSystem ;
    rdfs:range    xsd:double .

nestv:hisigAdjustedPValue a rdf:Property, owl:DatatypeProperty ;
    rdfs:label    "HiSig adjusted p-value" ;
    rdfs:comment  "Benjamini-Hochberg-corrected empirical p-value from HiSig's permutation
                   test, pan-cancer. One value per system, emitted for all 395 (277 are
                   exactly 1.0, i.e. not significant). Node property rather than
                   biolink:adjusted_p_value because that slot's domain is
                   biolink:Association." ;
    rdfs:seeAlso  OBI:0000175 ,     # p-value
                  NCIT:C61596 ;     # Benjamini-Hochberg Procedure — the correction applied
    rdfs:domain   ndexv:ProteinSystem ;
    rdfs:range    xsd:double .
```

**Known modelling caveats**, recorded rather than papered over:

- **No standard class fits a data-derived protein set.** `biolink:GeneFamily` is grouping
  "by common descent" (wrong mechanism); `biolink:MacromolecularComplex` is a "*stable*
  assembly" — true for the median system (Size 10) but false for the large ones. Hence a
  minted class, with **no `skos:closeMatch` to `GO:0032991`**: it would be accurate only for
  the small end of the range, so the alignment is left unasserted rather than approximated.
- **No ontology term exists for the mutation frequency.** Checked: NCIT "Mutation Rate" and
  "Somatic Variation Rate" are per-*sample*; `STATO:0000254`/`NCIT:C154665`/`SO:0002119`
  allele frequency are allele-level; `STATO:0000607` "proportion" is correct but generic and
  is a class, not a predicate. The quantity is a patient-level prevalence over a gene set.
- **`biolink:has_quotient` comes from the `FrequencyQuantifier` mixin**, which bare
  `biolink:Association` does not include (only four classes do). Treated as a documented
  extension.
- **No standard predicate exists for a regression coefficient.** `STATO:0000565` "regression
  coefficient" defines the quantity exactly but is a *class* (a data item), not a property,
  and Biolink's `aggregate_statistic` children (`has_count`/`has_total`/`has_quotient`/
  `has_percentage`) do not cover it. Hence a minted property with `rdfs:seeAlso` to STATO
  rather than a claimed equivalence.
- **`nestv:hisigWeight` on the node is a bare statistic.** Unlike the association slots it
  carries no `knowledge_level`, `agent_type` or `has_evidence` alongside it; that context
  lives only in the `rdfs:comment`. Accepted as the cost of attaching a per-system value to
  the system itself. The correction method is likewise documented once on
  `nestv:hisigAdjustedPValue` (`rdfs:seeAlso NCIT:C61596`) rather than repeated as a triple
  on all 395 systems, since it is constant.

---

## 7. Worked example — NEST:284

Source: `Annotation` "Collagen I, III, V", `Size` 5, one parent (NEST:217), no children,
flagged in HNSC/LUAD/LUSC/SKCM/UCEC, `adjusted p-value` 1.0, `Weight` 0.65.

```turtle
nest:NEST-284 a ndexv:ProteinSystem ;
    rdfs:label         "Collagen I, III, V" ;
    dcterms:identifier "NEST:284" ;
    ndexv:memberCount        5 ;
    nestv:hisigWeight        0.65 ;
    nestv:hisigAdjustedPValue 1.0 .

nest:NEST-284 biolink:part_of nest:NEST-217 .          # Collagens I, III, V, VI

nest:NEST-284 biolink:has_member uniprot:P02452, uniprot:P08123, uniprot:P02461,
                                 uniprot:P20908, uniprot:P05997 .

nest:NEST-284-SKCM a biolink:Association ;
    biolink:subject             nest:NEST-284 ;
    biolink:predicate           biolink:genetically_associated_with ;
    biolink:object              MONDO:0005012 ;
    nestv:tumorsMutatedFraction 0.518 ;
    biolink:knowledge_level     biolink:statistical_association ;
    biolink:agent_type          biolink:data_analysis_pipeline ;
    biolink:has_evidence        ECO:0007672 .
# ... and HNSC 0.133, LUAD 0.28, LUSC 0.258, UCEC 0.227

# no nest:NEST-284-hisig : adjusted p = 1.0 is not a finding.
```

NEST:284 shows why both HiSig statistics sit on the node. Its weight of **0.65** is well
above the 0.37 median, but its adjusted p-value is **1.0** — the system was not selected
pan-cancer. Both numbers are present, so the weight cannot be read as a finding on its own;
it also gets no `nest:NEST-284-hisig` association, which is the assertion it does not
support. Its real findings are the five per-cohort associations.

Its five members form a **complete clique** in the IAS network — all 10 pairs present, all
`core`, scores 0.642–0.749 — emitted by the IAS half of the export
([IAS_NETWORK_GENERATION.md §6](IAS_NETWORK_GENERATION.md)).

---

## 8. Volumes (cutoff 400)

| | count |
|---|---:|
| system nodes — type, label, identifier, `memberCount` (395 × 4) | 1,580 |
| `nestv:hisigWeight` (394 non-zero) | 394 |
| `nestv:hisigAdjustedPValue` (all 395) | 395 |
| `part_of` | 466 |
| `has_member` | 11,348 |
| per-cohort associations (589 × 8) | 4,712 |
| pan-cancer associations (112 × 7) | 784 |
| vocabulary axioms | ~30 |
| **hierarchy total** | **~19,700** |

375 systems emit payload, 20 suppressed; membership covers 5,339 distinct proteins.

For context the combined export is ~1,318,000 triples — **the hierarchy is 1.4 % of it**;
the IAS interaction network is the rest.

---

## 9. Decisions and open items

### Resolved (2026-08-03)
1. All 395 nodes and all 466 `part_of` edges emitted; the cutoff gates payload only. ✅
2. Containment = `biolink:part_of`, child-subject, full DAG, unreified; `Tree_edge` dropped. ✅
3. Node class = `ndexv:ProteinSystem`; IRI `nest:NEST-<n>`. ✅
4. `Size` → `ndexv:memberCount` (subPropertyOf `biolink:has_count`). ✅
5. Membership = `biolink:has_member` via `HCX::members`; root suppressed by the cutoff. ✅
6. Size cutoff = **400**. ✅
7. Associations = `biolink:genetically_associated_with`; per-cohort with frequency as evidence, plus pan-cancer where adjusted p < 0.05. ✅
8. Cancer types → MONDO via the verified anchor-based mapping (13/13). ✅
9. `Annotation` → `rdfs:label` only; no ontology mapping. ✅
10. Namespaces under `ndexbio.org`; `okn:` retired. ✅
11. Derived/display attributes dropped (§4.7). ✅

12. **Node-level attributes are always emitted, for every node that has them** — the size cutoff gates only `has_member` and the associations (§4.2, §4.6). ✅
12a. **Both HiSig statistics are node properties**: `nestv:hisigWeight` (394 non-zero, root skipped) and `nestv:hisigAdjustedPValue` (all 395, including the 277 at 1.0). Minted rather than `biolink:adjusted_p_value`, whose domain is `biolink:Association`. The pan-cancer association therefore carries no statistic — it is the assertion, the node holds the evidence (§4.2, §4.5b). ✅
12b. **`nestv:correctionMethod` removed** — constant across all records, so documented once as `rdfs:seeAlso NCIT:C61596` on the p-value property instead of repeated 395 times. ✅
13. **No `skos:closeMatch GO:0032991`** on `ndexv:ProteinSystem` — dropped as inaccurate for the larger systems. ✅

### Resolved (2026-08-04)
14. **Implemented.** Two equivalent converters, [nest/nest_to_rdf.py](nest/nest_to_rdf.py)
    and [nest/nest_to_rdf.mjs](nest/nest_to_rdf.mjs), emit this specification plus the IAS
    half into one Turtle file. Their outputs are **byte-identical** — diffing them is the
    regression test — and both reproduce the committed [nest/nest.ttl](nest/nest.ttl)
    exactly (sha256 `3a7a8a58…`, verified 2026-08-04). ✅

    | | emitted |
    |---|---:|
    | system nodes | 395 (20 above the cutoff emit no payload) |
    | `part_of` | 466 |
    | `has_member` | 11,348 |
    | per-cohort associations | 589 |
    | pan-cancer associations | 112 |
    | IAS protein nodes | 16,840 |
    | IAS interactions / statements | 209,956 (5,220 backbone; 40 self-loops dropped) |
    | **total triples** | **1,318,375** |

    Every figure matches the §8 projection. The converters read the **NDEx deposits by UUID**
    rather than the local CX2 files (§10).

### Open
1. **Vocabulary axioms (§6) are emitted but not reviewed** — in particular whether
   `SIO:000616` (collection) is worth carrying as a superclass. Note the shipped
   `rdfs:comment` strings are lightly reworded from the §6 draft (the counts specific to this
   build were generalized); §6 remains the design of record, `nest.ttl` the exact text.
2. **No adapter under `bio-cx2-to-rdf/src/adapters/`, and none planned** — superseding the
   earlier blocked item. NeST conversion ships as the standalone converters above; that
   TypeScript converter stays NCI-PID-only. The gaps it *would* have needed — no
   literal-triple type on `RdfOutput`, a `ReifiedStatement` shape hardcoding NCI-PID evidence
   fields, no adapter registry, and no streaming output — remain open **as NCI-PID-side
   debt**, but no longer block anything here. The `okn:`/`example.org` base is **no longer
   among them**: NCI-PID retired it on 2026-08-10 for
   `https://www.ndexbio.org/identifiers/` and `https://www.ndexbio.org/vocab/ncipid/`,
   matching the convention here. Base IRIs are still hardcoded in `namespace-manager.ts`
   rather than adapter-supplied, so a second adapter would need its own.
3. **Not deployed.** There is no `nest` entry in the OKN registry and no live SPARQL
   endpoint; `apps.okn.us/nest/sparql` returns the registry web application, not a query
   service. Deposit is gated on open item 1 of
   [IAS_NETWORK_GENERATION.md §9](IAS_NETWORK_GENERATION.md) — both NDEx source networks are
   still `UNLISTED` and owned by `cjtest` (re-verified 2026-08-04).

Shared open items — the NDEx deposits' visibility, the Bioregistry `ndex` record, and
`merge_cx2.py`'s stale stem — are tracked in
[IAS_NETWORK_GENERATION.md §9](IAS_NETWORK_GENERATION.md).

> **See [remaining_issues.md](remaining_issues.md)** for the full cross-graph audit
> (2026-08-04), including defects in the *deployed* NCI-PID graph and the blockers gating
> NeST publication, each with a reproduction command.

---

## 10. Pipeline artifacts (in `nest/`)

| file | kind | description |
|---|---|---|
| `NeST Map - Main Model.cx2` | input | source hierarchy (395 systems, 466 edges) |
| `build_hcx_hierarchy.py` | script | main model + IAS CX2 → HCX (adds `HCX::members`, the link) |
| `NeST_hierarchy_HCX.cx2` | output | **the HCX hierarchy** deposited as `4f9210a1-…` |
| `nest_cancer_types.tsv` | input | the 13 cohorts, curated MONDO search terms, 2 overrides |
| `map_cancer_types_to_mondo.py` | script | anchor-verified cohort → MONDO resolver |
| `cancer_type_mondo_map.tsv` | output | **the mapping** (13/13, 0 review) |
| `mondo_lookup_cache.json` | cache | OLS responses; committed for offline/deterministic re-runs |
| `symbol_curie_map.tsv` | input | symbol → `uniprot:`/`hgnc:` (from the IAS pipeline) |
| `nest_to_rdf.py` | script | **the RDF converter** — hierarchy UUID → Turtle (hierarchy + IAS) |
| `nest_to_rdf.mjs` | script | equivalent Node implementation; byte-identical output (§9) |
| `nest.ttl` | output | **the knowledge graph** — 1,318,375 triples |
| `.ndex-cache/` | cache | downloaded CX2 keyed by UUID; **untracked** (≈55 MB), rebuilt on first online run |

> **The RDF stage does not read the local CX2 files.** `nest_to_rdf` takes the *hierarchy's
> NDEx UUID*, reads `HCX::interactionNetworkUUID` off it to locate the IAS network, and
> downloads both — so the graph is generated from the deposited artifacts a third party can
> also fetch, not from working copies. `--offline` reuses `.ndex-cache/` and fails rather
> than downloading. The local `NeST Map - Main Model.cx2` and `IAS_network.cx2` remain the
> *inputs to the deposits*, one stage upstream.

---

**Last updated:** 2026-08-04
**Reviewer:** (pending)
