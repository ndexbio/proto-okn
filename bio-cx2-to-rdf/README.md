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
│   │   ├── turtle-writer.ts          # RDF to Turtle serialization
│   │   └── uri-builder.ts            # URI construction utilities
├── scripts/
│   └── refresh-bioregistry.js        # Build-time: regenerate bioregistry-prefixes.ts
│   └── adapters/
│       └── nci-pid/
│           ├── index.ts                  # NCI-PID adapter entry
│           ├── relationship-parser.ts   # HTML/evidence parsing
│           └── indra-type-mapper.ts     # INDRA to RDF mappings
├── dist/                         # Compiled JavaScript output
├── tests/                        # Test directory
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

The canonical stems are **vendored at build time** in `src/core/bioregistry-prefixes.ts`, regenerated
by `npm run refresh:bioregistry` (queries the Bioregistry API). A pinned snapshot keeps conversion
deterministic and offline.

> **Future:** as this becomes a general cx2→RDF tool, unknown prefixes may instead be resolved
> against the **live Bioregistry API during conversion** (with caching) — see
> [CX2_TO_RDF_DESIGN.md §4.1.1](../CX2_TO_RDF_DESIGN.md).

This handles namespace canonicalization only; entity *equivalence* (e.g. a non-canonical UniProt
isoform accession) is left to `owl:sameAs` links plus a downstream node normalizer (FRINK).

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
  converter falls back to a minted `…/okn/pathway/<slug|uuid>` IRI (the `pathway:` prefix).
- **Node membership** → `protein RO:0000056 pathway` (participates in), flipped to protein-subject;
  a direct triple, no reification.
- **Edge → pathway** → each reified interaction statement gets `okn:inPathway <pathway>` for every
  pathway in which **both** endpoints participate.

```turtle
ndex:f7585a28-45d0-11ed-b7d0-0ac135e8bacf a biolink:Pathway ;
    rdfs:label "IL5-mediated signaling events" .

uniprot:A0AVQ5 RO:0000056 ndex:f7585a28-45d0-11ed-b7d0-0ac135e8bacf .   # LYN participates_in IL5

okn:statement_582_0 a rdf:Statement ;
    rdf:subject uniprot:A8K1D9 ; rdf:predicate RO:0002629 ; rdf:object uniprot:A0AVQ5 ;
    okn:evidenceCount 6 ; okn:evidenceUrl <…> ;
    okn:inPathway ndex:f7585a28-45d0-11ed-b7d0-0ac135e8bacf .
```

> **Note:** `okn:inPathway` is a **co-membership heuristic** (both endpoints in the pathway), which
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

The minted IRI (`family:` = `…/okn/family/<slug>-<hash>`) also replaces the family's id→IRI entry,
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

## Documentation

For detailed design and implementation documentation, see:

- [CX2_TO_RDF_DESIGN.md](../CX2_TO_RDF_DESIGN.md) - Comprehensive design document
- [IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md) - Implementation roadmap
- [NEST_HIERARCHY_DATASET.md](../NEST_HIERARCHY_DATASET.md) - Nest Hierarchy adapter specification

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
  ├── NCI-PID 2.0 Adapter (implemented)
  └── Nest Hierarchy Adapter (planned)
```

## License

MIT
