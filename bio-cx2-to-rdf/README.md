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
│   │   ├── namespace-manager.ts      # RDF namespace handling
│   │   ├── turtle-writer.ts          # RDF to Turtle serialization
│   │   └── uri-builder.ts            # URI construction utilities
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
| RO | http://purl.obolibrary.org/obo/RO_ | Relations Ontology |
| GO | http://purl.obolibrary.org/obo/GO_ | Gene Ontology |
| SIO | http://semanticscience.org/resource/SIO_ | Semantic Science Ontology |
| uniprot | http://identifiers.org/uniprot/ | UniProt protein identifiers |
| chebi | http://identifiers.org/chebi/CHEBI: | Chemical Entities of Biological Interest |

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

## Output Format

The tool generates Turtle (`.ttl`) format RDF. Example output:

```turtle
@prefix uniprot: <http://identifiers.org/uniprot/>.
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
