# Symbol → Identifier Mapping — IAS Network

**Status:** ✅ Implemented — [nest/build_symbol_curie_map.py](nest/build_symbol_curie_map.py)
**Purpose:** Turn the HGNC gene symbols used in the IAS network (Data S1 of Zheng et al., *Science* 374, eabf3067, 2021) into stable identifier CURIEs for node IRIs. Proteins become **UniProt** accessions (the OKN-recommended identifier); the small set of symbols with no protein keep an **HGNC gene** identifier. Companion of [IAS_NETWORK_GENERATION.md](IAS_NETWORK_GENERATION.md) §7.

---

## 1. Why a mapping is needed

Data S1 identifies proteins by **HGNC gene symbol** (`MCM2`, `PIK3CA`, …), but:
- The [OKN biomedical-identifier registry](https://registry.okn.us/book/biomedical-identifiers/) recommends **UniProt** for proteins (`http://purl.uniprot.org/uniprot/$1`).
- The existing NCI-PID KG uses `uniprot:` IRIs, so mapping to UniProt lets the two graphs **join on protein IRIs**.
- Gene symbols are unstable (renamed, withdrawn, duplicated) — they are a poor primary key.

So every symbol is resolved to a canonical CURIE at load time.

---

## 2. Output

`nest/symbol_curie_map.tsv` — one row per distinct symbol in the network:

| column | meaning |
|---|---|
| `symbol` | HGNC gene symbol as it appears in Data S1 |
| `curie` | `uniprot:<accession>` (protein) or `hgnc:<numeric id>` (gene) |
| `id_type` | `protein` \| `gene` |
| `route` | how it resolved (see §4) |
| `hgnc_id` | numeric HGNC id, when the fallback was used |
| `all_uniprot` | all UniProt accessions found (pipe-separated); canonical = first |
| `note` | reason, for non-protein symbols |

### Result (verified, 16,840 symbols)
| | count | % |
|---|---:|---:|
| → `uniprot:` (protein) | **16,828** | 99.93 % |
| → `hgnc:` (gene, no protein) | **12** | 0.07 % |
| distinct UniProt accessions | 16,767 | — |

61 symbols share an accession with another (histone clusters, tandem paralogs, legacy aliases) — see §6.

---

## 3. Identifier choice

| node kind | CURIE | IRI stem | rationale |
|---|---|---|---|
| protein | `uniprot:P49736` | `http://purl.uniprot.org/uniprot/` | OKN-recommended; joins with NCI-PID KG |
| non-protein gene | `hgnc:372` | `https://bioregistry.io/hgnc:` → HGNC report | stable gene identifier for symbols with no protein product |

For the 12 non-protein symbols we deliberately keep an **HGNC gene identifier** rather than force a wrong protein accession or silently drop the node. `hgnc:<id>` uses the **numeric, stable** HGNC id (e.g. `hgnc:372`), which persists even for withdrawn/renamed genes — unlike the symbol string.

> Last-resort only: a symbol not present in HGNC at all would fall back to `hgnc.symbol:<SYMBOL>`. This does **not** occur in the current network (all 16,840 resolve to `uniprot:` or `hgnc:`), but the script handles it.

> Note: the OKN registry separately recommends Entrez `geneid:` for gene-level nodes. We use `hgnc:` here because (a) the source is HGNC-native and (b) the 12 are a non-protein *residue* of a protein network, not a gene-level dataset. Switching the gene fallback to `geneid:` is a one-line change if preferred.

---

## 4. Resolution algorithm

Implemented in `resolve()` in [nest/build_symbol_curie_map.py](nest/build_symbol_curie_map.py). First rule that yields an accession wins.

**Protein routes (→ `uniprot:`)**
1. `approved_symbol` — HGNC approved `symbol` carries a `uniprot_ids` value.
2. `prev_symbol` — the symbol is a *previous* symbol of an approved gene that carries a UniProt id (renamed genes). `_ambiguous` suffix if >1 such gene.
3. `alias_symbol` — same, via alias symbols.
4. `uniprot_api:reviewed_exact` / `uniprot_api:unreviewed_exact` — **UniProt REST fallback**, for symbols HGNC leaves with a *blank* `uniprot_ids` (a known HGNC gap; e.g. `UBE2O`, `ABHD4`, `IQCD`). Queries `gene_exact:<sym> AND organism_id:9606`, reviewed first.

**Gene fallback (→ `hgnc:`)**
5. `hgnc_id_fallback` — no protein anywhere. Take the numeric HGNC id from the approved record, else the prev-symbol record, else the withdrawn report.
6. `hgnc_symbol_fallback` — symbol absent from HGNC entirely (not observed here).

**Canonical pick when a symbol has multiple UniProt ids:** the first listed (`all_uniprot` keeps the rest). HGNC lists reviewed Swiss-Prot accessions first, so this favors the reviewed canonical. 43 symbols have >1 accession.

---

## 5. The 12 non-protein symbols

Every one was checked against the HGNC REST API and the HGNC withdrawn report, then UniProt. None has a distinct human protein; each keeps its HGNC id. Full provenance: [nest/unmapped_symbols_hgnc_status.tsv](nest/unmapped_symbols_hgnc_status.tsv).

| symbol | curie | HGNC status | why no protein |
|---|---|---|---|
| ALG1L | `hgnc:33721` | renamed → **ALG1L1P** | pseudogene |
| C22orf46 | `hgnc:26294` | renamed → **C22orf46P** | pseudogene |
| C6orf48 | `hgnc:19078` | renamed → **SNHG32** | ncRNA host gene |
| LRRC29 | `hgnc:13605` | renamed → **FBXL9P** | pseudogene |
| PPP5D1 | `hgnc:44209` | renamed → **PPP5D1P** | pseudogene |
| CRIPAK | `hgnc:26619` | withdrawn | not a real gene |
| GVQW1 | `hgnc:31424` | withdrawn | deleted |
| OCLM | `hgnc:8103` | withdrawn | deleted (oculomedin) |
| SPHAR | `hgnc:16957` | withdrawn | deleted |
| U2AF1L5 | `hgnc:51830` | withdrawn | GRCh38 duplicate of U2AF1; no distinct UniProt accession |
| AKAP2 | `hgnc:372` | approved | complex-locus constituent; protein is readthrough PALM2AKAP2 (`uniprot:Q9Y2D5`), no standalone AKAP2 |
| C3orf36 | `hgnc:26170` | approved | locus_type "unknown", no protein product |

Two deliberately **not** force-mapped: `AKAP2` (Q9Y2D5's gene names are `PALM2AKAP2/PALM2`, not AKAP2 — that accession belongs to PALM2) and `U2AF1L5` (neither HGNC nor UniProt assigns it a distinct accession).

---

## 6. Collisions (multiple symbols → one accession)

16,828 protein symbols collapse to 16,767 distinct accessions; **61 symbols share** with another. All biologically expected:
- **Histone gene clusters** — 13 `HIST1H4*` → `P62805`, 10 `HIST1H3*` → `P68431`, etc.
- **Tandem paralog pairs** — `HBA1/HBA2`, `CKMT1A/CKMT1B`, `SMN1/SMN2`, `CGB3/CGB5`, `SERF1A/SERF1B`, …
- **Legacy alias / current-symbol pairs** — `IRF4/MUM1`, `SEPT4/C17orf47`, `MACF1/KIAA0754`.

**Consequence for node keying (open decision, see §7 of the network spec):** if nodes are keyed on the UniProt accession, these 61 symbols merge into shared nodes and the incident IAS edges collapse onto them, altering topology. Recommended: **key nodes on the gene symbol, carry `represents = <curie>` as an attribute** — preserves the paper's gene-level network while still joining to NCI-PID via the shared accession. This mapping file supports either choice.

---

## 7. Inputs & reproducibility

| file | source | note |
|---|---|---|
| `hgnc_complete_set.txt` | `https://storage.googleapis.com/public-download-files/hgnc/tsv/tsv/hgnc_complete_set.txt` | HGNC complete set; `symbol`, `uniprot_ids`, `prev_symbol`, `alias_symbol`, `hgnc_id`, `status` |
| `hgnc_withdrawn.txt` | `https://storage.googleapis.com/public-download-files/hgnc/tsv/tsv/withdrawn.txt` | withdrawn-symbol → HGNC id |
| `uniprot_fallback_cache.json` | written by the script | caches UniProt REST results so re-runs are **offline and deterministic** — commit it |

Both HGNC files are dated snapshots; record the download date when refreshing. The UniProt fallback fires only for symbols HGNC leaves blank (~24), so a first run needs network access; subsequent runs read the cache.

### Run
```bash
cd nest
# one-time downloads (see URLs above) -> hgnc_complete_set.txt, hgnc_withdrawn.txt
python3 build_symbol_curie_map.py \
    --network science.abf3067_data_s1_to_s3/abf3067_Data_S1.tsv \
    --p1-col "Protein 1" --p2-col "Protein 2" \
    --out symbol_curie_map.tsv
```
The `--network` arg accepts any TSV with two symbol columns (e.g. the filtered `ias_network_no_orphans.tsv`), so the map can be regenerated for whichever edge set is built.

---

**Last updated:** 2026-07-23
