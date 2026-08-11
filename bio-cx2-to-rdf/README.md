# bio-cx2-to-rdf

A TypeScript library and CLI tool for converting biological network data from CX2 (Cytoscape Exchange Format version 2) to RDF (Resource Description Framework) using Turtle serialization.

## Overview

This tool converts NCI-PID (National Cancer Institute Pathway Interaction Database) version 2.0 networks from CX2 format into semantic RDF triples. It extracts biological entities (proteins), their relationships, and associated INDRA (Integrated Network and Dynamical Reasoning Assembler) evidence metadata.

### Key Features

- Parses CX2 JSON-based network format
- Extracts biological entities and their relationships
- Processes INDRA evidence metadata from network attributes
- Generates RDF triples with semantic relationships using standard ontologies
- Reifies relationship statements with evidence metadata (evidence counts, URLs)
- Supports namespace management for biological ontologies
- Modular adapter architecture for multiple dataset types

## Prerequisites

- Node.js 18 or later
- npm or yarn

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd proto-okn/bio-cx2-to-rdf

# Install dependencies
npm install

# Build the project
npm run build
```

## Usage

### Command Line Interface

```bash
# Basic usage
npm start <input.cx2> -o <output.ttl>

# With verbose output
npm start <input.cx2> -o <output.ttl> --verbose

# Or run directly with node
node dist/cli/index.js <input.cx2> -o <output.ttl> -v
```

### CLI Options

| Option | Description |
|--------|-------------|
| `<input>` | Input CX2 file path (required) |
| `-o, --output <path>` | Output Turtle file path (optional; defaults to stdout) |
| `--uuid <uuid>` | Network UUID for statement URIs (optional) |
| `-v, --verbose` | Enable verbose output |

### Examples

```bash
# Convert a small example network
npm start ../small_example.cx2 -o output.ttl -v

# Convert the p53 pathway network
npm start "../Direct p53 effectors (v2.0).cx2" -o p53.ttl --verbose

# Output to stdout
npm start ../Ephri_B.cx2
```

## Project Structure

```
bio-cx2-to-rdf/
├── src/
│   ├── cli/
│   │   └── index.ts              # CLI entry point
│   ├── core/
│   │   ├── types.ts                  # Type definitions
│   │   ├── attribute-declarations.ts # CX2 attributeDeclarations parsing + alias/default normalization
│   │   ├── cx2-parser.ts             # CX2 JSON parser (normalizes node/edge attributes)
│   │   ├── namespace-manager.ts      # RDF namespaces + Bioregistry @context canonicalization
│   │   ├── bioregistry-prefixes.ts   # Vendored Bioregistry canonical prefix map (generated)
│   │   ├── chemical-normalization.ts # Vendored chemical id normalization map (generated)
│   │   ├── turtle-writer.ts          # RDF to Turtle serialization
│   │   └── uri-builder.ts            # URI construction utilities
├── scripts/
│   ├── refresh-bioregistry.js        # Build-time: regenerate bioregistry-prefixes.ts
│   └── normalize-chemicals.js        # Build-time: normalize smallmolecule ids via RENCI Node Normalizer
│   └── adapters/
│       └── nci-pid/
│           ├── index.ts                  # NCI-PID adapter entry
│           ├── relationship-parser.ts   # HTML/evidence parsing
│           └── indra-type-mapper.ts     # INDRA to RDF mappings
├── dist/                         # Compiled JavaScript output
├── tests/                        # node:test suite (runs against dist/)
│   ├── helpers/cx2.js                # CX2 fixture builders
│   ├── regression.test.js            # one test per published-graph defect
│   └── *.test.js                     # per-module unit tests
├── package.json
└── tsconfig.json
```

## Dependencies

### Runtime Dependencies

- **commander** (^12.0.0): CLI argument parsing
- **n3** (^1.17.2): RDF/Turtle serialization (RDFJS-compliant)

### Development Dependencies

- **typescript** (^5.3.3): TypeScript compiler
- **@types/node** (^20.10.0): Node.js type definitions
- **@types/n3** (^1.16.4): N3 type definitions
- **linkedom** (^0.16.11): DOM implementation for HTML parsing

## Development

```bash
# Build the project
npm run build

# Watch mode for development
npm run dev

# Run the CLI
npm start <input.cx2> -o <output.ttl>
```

## Tests

```bash
npm test        # builds, then runs the suite
npm run test:only   # skip the build (use after `npm run dev`)
```

102 tests on Node's built-in runner — **no test framework dependency**, matching the
zero-network, zero-extra-tooling posture of the rest of the package. The suite runs against
`dist/`, not `src/`: `tsconfig.json` excludes `tests/`, so what is tested is exactly the
JavaScript the CLI ships.

| File | Covers |
|---|---|
| `attribute-declarations.test.js` | alias resolution, default materialization, falsy-value handling |
| `namespace-manager.test.js` | prefix resolution (incl. case-insensitivity), Bioregistry canonicalization, base IRIs |
| `uri-builder.test.js` | type mapping, identifier-space inference, minted IRIs, slug/IRI helpers |
| `cx2-parser.test.js` | end-to-end aspect parsing, `@context` handling, id lookups |
| `indra-mapping.test.js` | INDRA type → RO/GO mapping, relationship/evidence parsing |
| `nci-pid-adapter.test.js` | node typing, chemical normalization, families, pathway membership, dedup, self-loops |
| `turtle-writer.test.js` | serialization: `rdf:type` omission, `skos:exactMatch`, IRI escaping |
| `regression.test.js` | one end-to-end test per defect in [remaining_issues.md](../remaining_issues.md) |

`regression.test.js` is the important one. Each test corresponds to a numbered issue found in
the published graph and asserts on **serialized Turtle**, so it fails if any layer — type
mapping, prefix resolution, or serialization — reintroduces the defect:

- **issue 2** — bare names must not leak as unresolvable identifiers
- **issue 3** — no relative, scheme-less IRIs anywhere in the document
- **issue 6** — "select all proteins" must return no chemicals
- **issue 7** — the `example.org` placeholder must appear nowhere
- **issue 9** — ChEBI must canonicalize despite a lowercase `@context`

The suite was mutation-checked: reintroducing each original bug in turn (the
default-to-protein fallback, `smallmolecule` missing from the type map, case-sensitive prefix
lookup, and an override leaking its rejected clique) fails 2, 5, 9 and 1 tests respectively.

## Ontologies and Standards

The tool generates RDF using the following standard ontologies:

| Prefix | Namespace | Description |
|--------|-----------|-------------|
| RO | http://purl.obolibrary.org/obo/RO_ | Relations Ontology (incl. `RO:0000056` participates in, `RO:0002351` has member) |
| GO | http://purl.obolibrary.org/obo/GO_ | Gene Ontology |
| SIO | http://semanticscience.org/resource/SIO_ | Semantic Science Ontology |
| biolink | https://w3id.org/biolink/vocab/ | Biolink Model (`biolink:Pathway`, `biolink:GeneFamily` node typing) |
| uniprot | http://purl.uniprot.org/uniprot/ | UniProt protein identifiers (Bioregistry-canonical) |
| chebi | http://purl.obolibrary.org/obo/CHEBI_ | Chemical Entities of Biological Interest (Bioregistry-canonical) |

## Identifier Canonicalization (Bioregistry)

CX2 networks declare their prefixes in `networkAttributes.@context`, but those often point at
non-preferred IRI bases (e.g. `uniprot` → `https://identifiers.org/uniprot/`). Before building
entity IRIs, the converter **canonicalizes each `@context` prefix against
[Bioregistry](https://bioregistry.io)**:

- A prefix with a Bioregistry **`rdf_uri_format`** (a real RDF identity IRI) is rewritten to the
  canonical stem — `uniprot` → `http://purl.uniprot.org/uniprot/`, `chebi` → `…/obo/CHEBI_`.
- A prefix without one (Bioregistry's canonical is just a provider webpage — `cas`, `hgnc.symbol`,
  `hprd`, `kegg.compound`) keeps its `@context` value.

Prefix lookup is **case-insensitive** (exact match preferred). CX2 files declare `"chebi"` in
`@context` but write `CHEBI:16618` on nodes; an exact-only lookup left every ChEBI entity as a
relative, scheme-less IRI (`<CHEBI:16618>`) that joins with nothing.

The canonical stems are **vendored as a committed snapshot** in `src/core/bioregistry-prefixes.ts`.
This file is generated, but it is **checked into the repo** (not produced at build time): it is a
compile-time `import`, and pinning a snapshot of the live Bioregistry API is what keeps conversion
**deterministic and offline** — builds need no network access and every checkout produces identical
IRIs.

To refresh the snapshot (e.g. to pick up new/changed canonical IRIs), run:

```bash
npm run refresh:bioregistry   # queries the Bioregistry API and rewrites bioregistry-prefixes.ts
```

then **commit the regenerated file** (its header records the fetch date). Do not delete it expecting
the build to regenerate it — `npm run build` is just `tsc` and will fail with a missing-module error
if the snapshot is absent.

> **Future:** as this becomes a general cx2→RDF tool, unknown prefixes may instead be resolved
> against the **live Bioregistry API during conversion** (with caching) — see
> [CX2_TO_RDF_DESIGN.md §4.1.1](../CX2_TO_RDF_DESIGN.md).

This handles namespace canonicalization only; entity *equivalence* (e.g. a non-canonical UniProt
isoform accession) is left to `owl:sameAs` links plus a downstream node normalizer — but note that
running the normalizer is **our** job, not the infrastructure's (see below).

## Chemical Identifier Normalization (Node Normalizer)

Bioregistry canonicalization answers *"given prefix `chebi`, what IRI stem?"*. It does **not**
answer *"which identifier space should a chemical use?"* — and for that, OKN's
[biomedical identifier guidance](https://registry.okn.us/book/biomedical-identifiers/) is explicit:

> Chemical entities (compounds, substances): prefer **PubChem CIDs**
> (`http://rdf.ncbi.nlm.nih.gov/pubchem/compound/CID$1`). **CAS registry numbers are imprecise.**

NCI-PID `type: "smallmolecule"` nodes are identified by `CHEBI:` or `cas:` CURIEs, so neither
matches the preferred space. The same page names the RENCI **Node Normalizer** as the conversion
tool, and phrases it as something the graph producer *may use* — **FRINK does not normalize
uploaded graphs.** `scripts/normalize-chemicals.js` is that step.

```bash
npm run build                # required: the tool reuses dist/core/cx2-parser.js
npm run normalize:chemicals  # queries the Node Normalizer, writes the review set
```

Resolution policy, applied per distinct source identifier:

1. **PubChem CID** from the normalizer clique → preferred subject IRI
2. else **ChEBI** from the clique → fallback subject IRI
3. else the **source identifier is kept unchanged** (nothing better exists)

The full clique is retained so the converter can emit it as `skos:exactMatch`. That is what keeps
step 3 recoverable and makes the normalizer's merges auditable instead of silent.

### Outputs

Written to `../chemical-normalization/` (override with `--out`):

| File | Purpose |
|---|---|
| `snapshot.json` | Full normalizer result per identifier — the durable artifact |
| `review.tsv` | One row per distinct identifier, for spreadsheet review |
| `review.md` | Same table plus per-flag summary counts |

### Review flags

**Normalization is not automatically safe, which is why this emits a table and not just a map.**
Rows are sorted worst-first:

| Flag | Meaning |
|---|---|
| `COLLISION` | Two+ distinct source ids normalize onto the **same** id — accepting merges separate CX2 nodes into one RDF entity. Resolve before accepting. |
| `CHEBI-DRIFT` | Clique ChEBI differs from the source: a stereoisomer, salt, or class merge. Review. |
| `NO-CID` | No PubChem CID in the clique; fell back to ChEBI. Expected for lipid/compound classes. |
| `OK` | Resolved to a PubChem CID. |
| `UNRESOLVED` | Normalizer does not recognize the id — a compound *class* (ceramide, sphingomyelin) or a bad source CAS number. |
| `NO-ID` | Node `represents` is a bare name, not a CURIE. Not normalizable. |

`COLLISION` exists because a collision is a property of the *set*, invisible when checking one row
at a time. In NCI-PID it catches a real defect: `CHEBI:16066` (11-cis-retinal) and `CHEBI:17898`
(all-trans-retinal) both normalize to PubChem CID 638015 ("Retinal"). Their isomerization *is* the
photon-detection step of visual signal transduction, so accepting that merge would turn the central
reaction of the pathway into a self-loop.

### Options

| Option | Default | Description |
|---|---|---|
| `--out <dir>` | `../chemical-normalization` | Output directory |
| `--types <list>` | `smallmolecule` | Comma-separated CX2 node types to collect |
| `--batch <n>` | `200` | Identifiers per normalizer request |
| `--offline` | off | Re-render tables from an existing `snapshot.json`, no network calls |

Trailing arguments override the scanned corpus (files or directories); the default is
`../data_files` plus any `.cx2` at the repo root.

> Like the Bioregistry snapshot, this is a **build-time** tool producing a committed artifact —
> conversion itself stays deterministic and offline.

## CX2 Attribute Handling

CX2 stores node and edge attributes under a `v` object whose keys are governed by the
`attributeDeclarations` aspect. The converter is **declaration-aware**, so it reads the
true value of every attribute regardless of how a particular file was written:

- **Aliases (`a`)**: A declared attribute may define a short alias that the data block
  must use in place of the full name (e.g. `represents` aliased to `r`, so a node stores
  `{"r": "uniprot:Q13547"}`). Files that declare no alias instead store the full name
  (`{"represents": "uniprot:Q13547"}`). The converter resolves both forms to the canonical
  full name.
- **Defaults (`v`)**: A declared attribute may define a default value. When an element omits
  that attribute, the converter materializes the declared default onto it (e.g. an edge with
  no `__edge_source` and a declared default of `"INDRA"` is read as `__edge_source = "INDRA"`).

This normalization runs once in `cx2-parser.ts` (via `attribute-declarations.ts`), rewriting
every node/edge `v` bag to canonical full-name keys before any RDF mapping. As a result the
same network converts identically whether it was exported with short aliases (single-pathway
NDEx files) or long names (e.g. Cytoscape re-exports of a merged network).

## Merged Networks & Pathway Provenance

Individual NCI-PID pathway networks can be merged into one network (e.g. by `merge_cx2.py`) that
adds **pathway provenance nodes** (`type: "pathway"`) and **membership edges**
(`interaction: "participates in"`) recording which pathway each protein came from. The converter
turns these into RDF — adding triples only, leaving protein/edge/evidence conversion and
single-pathway files untouched. Full design: [CX2_TO_RDF_DESIGN.md §4.8](../CX2_TO_RDF_DESIGN.md).

- **Pathway nodes** → IRI taken from the node's own `represents`, resolved through the network
  `@context`. A merged network sets it to the source NDEx network (`ndex:<uuid>` →
  `https://www.ndexbio.org/v3/networks/<uuid>`). Typed `biolink:Pathway`
  (`owl:equivalentClass PW:0000001`) and labelled with the pathway name (a trailing version marker
  like ` _v2_0_` is stripped). When `represents` is absent or its prefix is undeclared (e.g. the
  merge's non-resolvable `pathway:<name>` placeholder, emitted when no NDEx UUID was available), the
  converter falls back to a minted `…/identifiers/pathway/<slug|uuid>` IRI (the `pathway:` prefix).
- **Node membership** → `protein RO:0000056 pathway` (participates in), flipped to protein-subject;
  a direct triple, no reification.
- **Edge → pathway** → each reified interaction statement gets `ncipidv:inPathway <pathway>` for every
  pathway in which **both** endpoints participate.

```turtle
ndex:f7585a28-45d0-11ed-b7d0-0ac135e8bacf a biolink:Pathway ;
    rdfs:label "IL5-mediated signaling events" .

uniprot:A0AVQ5 RO:0000056 ndex:f7585a28-45d0-11ed-b7d0-0ac135e8bacf .   # LYN participates_in IL5

ncipid:statement_582_0 a rdf:Statement ;
    rdf:subject uniprot:A8K1D9 ; rdf:predicate RO:0002629 ; rdf:object uniprot:A0AVQ5 ;
    ncipidv:evidenceCount 6 ; ncipidv:evidenceUrl <…> ;
    ncipidv:inPathway ndex:f7585a28-45d0-11ed-b7d0-0ac135e8bacf .
```

> **Note:** `ncipidv:inPathway` is a **co-membership heuristic** (both endpoints in the pathway), which
> yields a *superset* of true edge memberships — the merge drops exact per-edge pathway provenance.
> It is intended for pathway-scoped queries; exact provenance is a planned `merge_cx2.py` follow-up.

## Protein/Gene Families

NCI-PID networks include **protein family** nodes (`type: "proteinfamily"`, e.g. "RAS family")
whose CX2 `represents` is a non-resolvable bare name. The converter mints a stable IRI from the
family's **member set** (so identical-membership families converge to one IRI; same-name/different-
members stay distinct), types it `biolink:GeneFamily`, and turns each `member` (an `hgnc.symbol:`
CURIE) into an `RO:0002351` (**has member**) triple — `biolink:has_member` maps exactly to
`RO:0002351`. Full design: [CX2_TO_RDF_DESIGN.md §4.9](../CX2_TO_RDF_DESIGN.md).

```turtle
family:Gq-family-57a2b211 a biolink:GeneFamily ;
    rdfs:label "Gq family" ;
    RO:0002351 hgnc.symbol:GNA11, hgnc.symbol:GNA14, hgnc.symbol:GNA15, hgnc.symbol:GNAQ .
```

The minted IRI (`family:` = `…/identifiers/family/<slug>-<hash>`) also replaces the family's id→IRI entry,
so interaction edges touching the family resolve to it rather than the bare name.

## Output Format

The tool generates Turtle (`.ttl`) format RDF. Example output:

```turtle
@prefix uniprot: <http://purl.uniprot.org/uniprot/>.
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>.
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>.
@prefix RO: <http://purl.obolibrary.org/obo/RO_>.
@prefix GO: <http://purl.obolibrary.org/obo/GO_>.
@prefix SIO: <http://semanticscience.org/resource/SIO_>.

uniprot:Q13547 a SIO:010043;
    rdfs:label "HDAC1";
    owl:sameAs uniprot:Q92534.
```

## Sample Data

Sample CX2 networks are available in the parent directory:

- `small_example.cx2` - Small sumoylation pathway test network
- `Ephri_B.cx2` - Ephrin B signaling pathway
- `Direct p53 effectors (v2.0).cx2` - Comprehensive p53 pathway

## NeST → RDF (standalone converters)

The NeST hierarchy and its IAS interaction network are converted by **standalone scripts in
[`nest/`](../nest/), not by this package** — they do not go through the adapter pipeline
above. Two implementations exist and produce **byte-identical** output; `diff` between them
is the regression test.

```bash
cd nest

# Python
python3 nest_to_rdf.py 4f9210a1-8797-11f1-857e-005056ae3c32 -o nest.ttl

# Node (identical output; use --max-old-space-size if the 54 MB IAS parse OOMs)
node --max-old-space-size=4096 nest_to_rdf.mjs 4f9210a1-8797-11f1-857e-005056ae3c32 -o nest.ttl
```

The single argument is the **NDEx UUID of the NeST hierarchy**. The interaction network is
located automatically from that network's `HCX::interactionNetworkUUID` attribute and
downloaded too. Both downloads are cached under `nest/.ndex-cache/`, so re-runs take about a
second; add `--offline` to require the cache and never hit the network.

| option | default | |
|---|---|---|
| `-o, --out` | `nest.ttl` | output Turtle file |
| `--cutoff` | `400` | systems with `Size` ≥ this emit no membership or associations (all nodes and containment edges are always emitted) |
| `--mondo` | `cancer_type_mondo_map.tsv` | cohort → MONDO mapping |
| `--cache-dir` | `.ndex-cache` | where downloaded CX2 files are cached |
| `--ndex` | `https://www.ndexbio.org` | NDEx server |
| `--offline` | | fail rather than download |
| `--dataset-version` | `1.0` | `pav:version` on the dataset node |

Output for the current deposits: **1,318,130 triples, ~57 MB** — 395 systems, 466 `part_of`,
11,348 `has_member`, 701 associations, 16,840 proteins and 209,956 interactions. It is a
generated artifact; regenerate rather than edit, and note that a new build **replaces** the
graph (minted statement IRIs are build-scoped — see the spec).

The cohort → MONDO table it reads is itself generated and verified by
`nest/map_cancer_types_to_mondo.py`; see [NEST_HIERARCHY_DATASET.md §5](../NEST_HIERARCHY_DATASET.md).

## Documentation

For detailed design and implementation documentation, see:

- [CX2_TO_RDF_DESIGN.md](../CX2_TO_RDF_DESIGN.md) - Comprehensive design document
- [IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md) - Implementation roadmap
- [IAS_NETWORK_GENERATION.md](../IAS_NETWORK_GENERATION.md) - IAS interaction network (NeST / Zheng et al. 2021): CX2 generation **and** RDF mapping spec
- [SYMBOL_TO_PROTEIN_MAPPING.md](../SYMBOL_TO_PROTEIN_MAPPING.md) - HGNC symbol → UniProt/HGNC CURIE resolution for the IAS network
- [NEST_HIERARCHY_DATASET.md](../NEST_HIERARCHY_DATASET.md) - NeST hierarchy (395 systems): full CX2 → RDF design spec

## Architecture

The project uses a dataset-specific adapter pattern:

```
Core Library (platform-agnostic)
  ├── CX2Parser
  ├── TurtleWriter (N3.js)
  ├── NamespaceManager
  └── URIBuilder
         │
         ▼
Dataset Adapters (pluggable)
  ├── NCI-PID 2.0 Adapter (implemented — the only one)
  ├── IAS Interaction Network Adapter (not planned — see note)
  └── NeST Hierarchy Adapter (not planned — see note)
```

> **NeST / IAS are converted outside this pipeline, and that is the settled decision.** Their
> RDF mapping is fully specified and implemented, but by the standalone
> `nest/nest_to_rdf.{py,mjs}` scripts above rather than as adapters here — they emit
> `nest/nest.ttl` (1,318,375 triples) directly. This package stays NCI-PID-only. The gaps
> below are therefore **NCI-PID-side debt**, not a blocked port; they are what routing NeST
> through here *would* have required:
>
> - `RdfOutput` has no literal-valued triple type — `directTriples` takes IRI objects only,
>   which blocks every score, p-value and count
> - `ReifiedStatement` hardcodes the NCI-PID evidence fields (`evidenceCount`,
>   `evidenceUrl`, `processType`) rather than carrying generic qualifiers
> - there is no adapter registry; `cli/index.ts` calls the NCI-PID adapter directly
> - the base IRIs are hardcoded in `namespace-manager.ts` rather than adapter-supplied — they
>   are now the correct NDEx stems (`example.org` was retired 2026-08-10), but a second adapter
>   would still need its own
> - output is accumulated in memory, which will not scale to the ~1.3 M triples NeST emits

## License

MIT
