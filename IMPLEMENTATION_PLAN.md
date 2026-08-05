# Biological CX2 to RDF Converter - Implementation Plan
## Multi-Dataset Converter with Adapter Pattern

## 1. Executive Summary

This document outlines the implementation plan for the **bio-cx2-to-rdf** converter, a multi-dataset biological network converter designed to support two primary use cases:

1. **Standalone CLI Tool**: Command-line application for batch conversion of CX2 files
2. **Library for Cytoscape Web**: Browser-compatible JavaScript/TypeScript library for real-time RDF serialization

> **Status note (2026-08-04).** This plan anticipated adapters for all three datasets. Only
> the **NCI-PID 2.0** adapter was built. NeST and the IAS network ship as standalone
> converters (`nest/nest_to_rdf.{py,mjs}` → `nest/nest.ttl`, 1,318,375 triples) and **no
> adapter for them is planned** — see
> [CX2_TO_RDF_DESIGN.md §1](CX2_TO_RDF_DESIGN.md) and
> [NEST_HIERARCHY_DATASET.md §9](NEST_HIERARCHY_DATASET.md). Read the multi-dataset framing
> below as the original design intent, not as current scope.

The implementation follows a **modular architecture with dataset-specific adapters**, enabling:
- Support for multiple biological network datasets (NCI-PID 2.0, the IAS interaction network, the NeST hierarchy, and future additions; see [IAS_NETWORK_GENERATION.md](IAS_NETWORK_GENERATION.md))
- Shared core infrastructure for CX2 parsing and RDF generation
- Dataset-specific logic isolated in pluggable adapters
- Code reuse across both deployment modes (CLI and browser)

---

## 2. Use Cases

### 2.1 Standalone CLI Tool

**Target Users**: Bioinformaticians, data scientists, pipeline developers

**Features**:
- Convert CX2 files to RDF Turtle format
- Batch processing of multiple files
- Optional network UUID specification
- Progress reporting and logging
- Input validation and error reporting
- Output to file or stdout

**Example Usage**:
```bash
# Single file conversion (auto-detects dataset)
bio-cx2-to-rdf network.cx2 -o output.ttl --uuid e5c9f6a2-3b1d-11ed-a261-0ac135e8bacf

# Force specific adapter
bio-cx2-to-rdf network.cx2 -o output.ttl --adapter nci-pid

# Batch conversion with auto-detection
bio-cx2-to-rdf *.cx2 -o ./output/ --batch

# Pipe to stdout
bio-cx2-to-rdf network.cx2 | gzip > output.ttl.gz
```

### 2.2 Cytoscape Web Integration

**Target Users**: Cytoscape Web application developers and end-users

**Features**:
- Browser-based RDF serialization
- Integration with Cytoscape.js network objects
- Real-time conversion triggered by user action
- Download RDF as file from browser
- No server-side processing required

**Example Usage**:
```typescript
import { CX2ToRDFConverter } from 'bio-cx2-to-rdf';

// In Cytoscape Web
const converter = new CX2ToRDFConverter(config);
const rdfTurtle = await converter.convert(cx2Network, networkUuid);

// Trigger download
converter.downloadAsFile(rdfTurtle, 'network.ttl');
```

---

## 3. Architecture Overview

### 3.1 Dual-Mode Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    bio-cx2-to-rdf Package                            │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │            Core Library (Platform-Agnostic)                │ │
│  ├────────────────────────────────────────────────────────────┤ │
│  │  • CX2Parser (generic)                                     │ │
│  │  • TurtleWriter (N3.js)                                    │ │
│  │  • Namespace Manager                                       │ │
│  │  • AdapterRegistry                                         │ │
│  └────────────────────────────────────────────────────────────┘ │
│                          ▲                                       │
│                          │                                       │
│  ┌───────────────────────┴─────────────────────────────────┐    │
│  │                Dataset Adapters                         │    │
│  ├─────────────────────────────────────────────────────────┤    │
│  │  ┌─────────────────┐        ┌──────────────────────┐   │    │
│  │  │  NCI-PID 2.0    │        │  Nest Hierarchy      │   │    │
│  │  ├─────────────────┤        ├──────────────────────┤   │    │
│  │  │ • HTML Parser   │        │  • Parser (TBD)      │   │    │
│  │  │ • Relationship  │        │  • Relationship      │   │    │
│  │  │   Mapper        │        │    Mapper (TBD)      │   │    │
│  │  │ • Ontology Map  │        │  • Ontology Map      │   │    │
│  │  │   (RO/GO)       │        │    (TBD)             │   │    │
│  │  └─────────────────┘        └──────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────┘    │
│                          ▲                                       │
│                          │                                       │
│         ┌────────────────┴────────────────┐                      │
│         │                                 │                      │
│  ┌──────▼──────────┐           ┌─────────▼─────────┐            │
│  │   CLI Wrapper   │           │  Browser Wrapper  │            │
│  ├─────────────────┤           ├───────────────────┤            │
│  │ • Commander.js  │           │ • File Download   │            │
│  │ • File I/O      │           │ • Blob API        │            │
│  │ • Progress bars │           │ • React hooks     │            │
│  │ • Logging       │           │ • Event handling  │            │
│  └─────────────────┘           └───────────────────┘            │
│         │                                 │                      │
│         ▼                                 ▼                      │
│   Node.js Binary                    ES Module                   │
│  (bio-cx2-to-rdf)                     (import in browser)           │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 Design Principles

1. **Platform Agnostic Core**: All business logic works in both Node.js and browser
2. **Minimal Dependencies**: Core has zero DOM/Node-specific dependencies
3. **Tree-Shakeable**: Browser builds only include necessary code
4. **Type-Safe**: Full TypeScript support throughout
5. **Testable**: Pure functions with dependency injection
6. **Progressive Enhancement**: Works without build tools (ESM)

---

## 4. Project Structure

> **Note — target vs. current layout.** The tree below is the *aspirational, fully
> modular* structure (with `parsers/`, `processors/`, `models/`, `rdf/`, `config/`, … sub-folders).
> The **current implementation is flatter**: core modules live directly under `src/core/` (e.g.
> `src/core/cx2-parser.ts`, `src/core/attribute-declarations.ts`, `src/core/types.ts`,
> `src/core/namespace-manager.ts`, `src/core/turtle-writer.ts`, `src/core/uri-builder.ts`), with the
> dataset adapter under `src/adapters/nci-pid/` and the CLI under `src/cli/`. The
> [README Project Structure](bio-cx2-to-rdf/README.md#project-structure) reflects the actual tree;
> the sub-folders below are introduced only as the codebase grows.

```
bio-cx2-to-rdf/
├── src/
│   ├── core/                      # Platform-agnostic core library
│   │   ├── parsers/                       # (target layout; currently flat under src/core/)
│   │   │   ├── cx2-parser.ts             # Generic CX2 JSON parser (normalizes attributes)
│   │   │   ├── attribute-declarations.ts # Parse attributeDeclarations; resolve aliases + defaults
│   │   │   └── context-parser.ts         # Parse @context namespaces
│   │   ├── adapters/
│   │   │   ├── base-adapter.ts    # Abstract base adapter interface
│   │   │   └── adapter-registry.ts # Adapter registration and selection
│   │   ├── processors/
│   │   │   ├── node-processor.ts  # Convert nodes to RDF
│   │   │   ├── edge-processor.ts  # Convert edges to RDF
│   │   │   └── metadata-processor.ts
│   │   ├── models/
│   │   │   ├── cx2-types.ts       # CX2 data structures
│   │   │   ├── rdf-types.ts       # RDF data structures
│   │   │   ├── adapter-types.ts   # Adapter interfaces
│   │   │   └── config-types.ts    # Configuration types
│   │   ├── rdf/
│   │   │   ├── turtle-writer.ts   # RDF Turtle generation (N3.js)
│   │   │   ├── namespace.ts       # Namespace management
│   │   │   ├── uri-builder.ts     # URI construction
│   │   │   └── ontology-mapper.ts # Map to RO/GO
│   │   ├── config/
│   │   │   ├── namespaces.ts      # Default namespace config
│   │   │   ├── predicates.ts      # Predicate mappings
│   │   │   └── ontologies.ts      # Ontology term mappings
│   │   ├── utils/
│   │   │   ├── validators.ts      # Input validation
│   │   │   └── string-utils.ts    # String manipulation
│   │   └── converter.ts           # Main converter orchestrator
│   │
│   ├── adapters/                  # Dataset-specific adapters
│   │   ├── nci-pid/               # NCI-PID 2.0 adapter
│   │   │   ├── index.ts           # Adapter implementation
│   │   │   ├── relationship-parser.ts  # Two-tier parser (URL params + text fallback)
│   │   │   ├── indra-type-mapper.ts    # Map INDRA types to RO/GO
│   │   │   ├── ontology-config.ts # RO/GO mappings
│   │   │   └── config.ts          # NCI-PID specific config
│   │   └── nest-hierarchy/        # Nest Hierarchy adapter
│   │       ├── index.ts           # Adapter implementation (TBD)
│   │       ├── parser.ts          # Parse relationships (TBD)
│   │       ├── relationship-mapper.ts  # Map to RDF predicates (TBD)
│   │       ├── ontology-config.ts # Ontology mappings (TBD)
│   │       └── config.ts          # Nest Hierarchy config (TBD)
│   │
│   ├── cli/                       # CLI-specific code (Node.js only)
│   │   ├── index.ts               # CLI entry point
│   │   ├── commands/
│   │   │   ├── convert.ts         # Convert command
│   │   │   └── batch.ts           # Batch convert command
│   │   ├── io/
│   │   │   ├── file-reader.ts     # Read CX2 from file
│   │   │   └── file-writer.ts     # Write Turtle to file
│   │   └── ui/
│   │       ├── progress.ts        # Progress indicators (ora)
│   │       └── logger.ts          # Console logging (chalk)
│   │
│   ├── browser/                   # Browser-specific code
│   │   ├── index.ts               # Browser entry point
│   │   ├── file-download.ts       # Blob download helper
│   │   └── hooks/
│   │       └── use-cx2-converter.ts  # React hook (optional)
│   │
│   └── index.ts                   # Main entry (exports core + appropriate wrapper)
│
├── tests/
│   ├── unit/
│   │   ├── parsers/
│   │   ├── processors/
│   │   └── rdf/
│   ├── integration/
│   │   └── converter.test.ts
│   └── fixtures/
│       ├── small_example.cx2
│       └── expected_output.ttl
│
├── examples/
│   ├── cli-usage.sh
│   ├── node-script.js
│   ├── browser-example.html
│   └── cytoscape-web-integration.tsx
│
├── docs/
│   ├── API.md                     # API documentation
│   ├── CLI.md                     # CLI documentation
│   └── CYTOSCAPE_INTEGRATION.md   # Cytoscape Web integration guide
│
├── package.json                   # Package configuration
├── tsconfig.json                  # Base TypeScript config
├── tsconfig.cli.json              # CLI build config
├── tsconfig.browser.json          # Browser build config
├── vite.config.ts                 # Vite bundler config (for browser)
├── vitest.config.ts               # Test configuration
├── .npmignore                     # NPM publish ignore
└── README.md                      # Project README
```

---

## 5. Core Module API Design

### 5.1 Main Converter API

```typescript
// src/core/converter.ts

import type { CX2Data, ConversionConfig, ConversionResult } from './models';

export interface ConversionOptions {
  /** Optional network UUID for provenance */
  networkUuid?: string;

  /** Custom namespace prefixes (merged with defaults) */
  customNamespaces?: Record<string, string>;

  /** Include okn:evidenceCount property declaration in output */
  includePropertyDeclarations?: boolean;

  /** Validate input CX2 structure */
  validateInput?: boolean;

  /** Progress callback for long-running conversions */
  onProgress?: (progress: ConversionProgress) => void;
}

export interface ConversionProgress {
  stage: 'parsing' | 'processing-nodes' | 'processing-edges' | 'generating-rdf';
  current: number;
  total: number;
  message?: string;
}

export interface ConversionResult {
  /** Generated Turtle RDF string */
  turtle: string;

  /** Statistics about the conversion */
  stats: {
    nodeCount: number;
    edgeCount: number;
    relationshipCount: number;
    tripleCount: number;
  };

  /** Any warnings encountered during conversion */
  warnings: string[];
}

export class CX2ToRDFConverter {
  constructor(config?: Partial<ConversionConfig>) {}

  /**
   * Convert CX2 data to RDF Turtle format
   * @param cx2Data - CX2 network data (JSON object or string)
   * @param options - Conversion options
   * @returns Conversion result with RDF and statistics
   */
  async convert(
    cx2Data: CX2Data | string,
    options?: ConversionOptions
  ): Promise<ConversionResult> {}

  /**
   * Convert CX2 data and return as ReadableStream (for large files)
   */
  convertStream(
    cx2Data: CX2Data | string,
    options?: ConversionOptions
  ): ReadableStream<string> {}
}
```

### 5.2 Parser API

```typescript
// src/core/parsers/cx2-parser.ts

export interface ParsedCX2 {
  declarations: CX2Declarations;   // parsed attributeDeclarations (nodes/edges/networkAttributes)
  networkAttributes: NetworkAttribute[];
  nodes: CX2Node[];                // attributes normalized to canonical full names
  edges: CX2Edge[];                // attributes normalized to canonical full names
}

export class CX2Parser {
  /**
   * Parse CX2 JSON data, then normalize every node/edge `v` bag to canonical
   * full-name keys using the attributeDeclarations aspect.
   */
  parse(input: string | object): ParsedCX2 {}

  /**
   * Validate CX2 structure
   */
  validate(data: ParsedCX2): ValidationResult {}
}
```

```typescript
// src/core/parsers/attribute-declarations.ts

export interface AttributeDeclaration { d: string; a?: string; v?: unknown }
export type AspectDeclarations = Record<string /* fullName */, AttributeDeclaration>;
export interface CX2Declarations {
  nodes: AspectDeclarations;
  edges: AspectDeclarations;
  networkAttributes: AspectDeclarations;
}

/** Read the attributeDeclarations aspect into structured per-aspect maps. */
export function parseAttributeDeclarations(aspects: unknown[]): CX2Declarations;

/**
 * Rewrite one element's `v` bag to canonical full-name keys:
 *  - alias resolution: read `v[decl.a ?? fullName]` (per CX2 spec the data block
 *    uses the alias when one is declared), with a lenient fallback to the full name;
 *  - default materialization: if the attribute is absent and the declaration carries
 *    a default `v`, assign that default;
 *  - undeclared keys pass through unchanged.
 */
export function normalizeAttributes(
  rawV: Record<string, unknown>,
  decls: AspectDeclarations,
): Record<string, unknown>;
```

### 5.3 NCI-PID Relationship Parser API

**Note**: This parser is NCI-PID adapter-specific, not part of core. Other dataset adapters will have their own relationship extraction logic.

```typescript
// src/adapters/nci-pid/relationship-parser.ts

export interface ParsedRelationship {
  subject: string;
  predicate: string;
  object: string;
  evidenceCount: number;
  evidenceUrl: string;
  indraType?: string;  // Original INDRA statement type (e.g., "Phosphorylation")
}

export class NCIPIDRelationshipParser {
  /**
   * Parse relationships using two-tier strategy:
   * 1. Primary: Extract subject/object/type from INDRA evidence URL parameters
   * 2. Fallback: Parse relationship text with known predicate matching
   *
   * URL parsing is preferred because it handles special characters
   * (NF-κB, BCL-2, IL-1β) reliably without regex.
   */
  parse(html: string): ParsedRelationship[] {}

  /**
   * Primary method: Parse INDRA evidence URL parameters
   * URL format: ?subject=X&object=Y&type=Z&format=html&expand_all=true
   */
  parseEvidenceUrl(url: string): { subject: string; object: string; type: string } | null {}

  /**
   * Fallback method: Parse relationship text using known predicates
   * Only used when URL parsing fails or URL is missing
   */
  parseRelationshipText(text: string): { subject: string; predicate: string; object: string } | null {}

  /**
   * Map INDRA statement type to RO predicate and optional GO process type
   * e.g., "Phosphorylation" -> { predicate: "RO:0002578", goType: "GO:0006468" }
   */
  mapIndraType(indraType: string): { predicate: string; goType?: string } {}

  /**
   * Extract total evidence count from "All Evidences" line
   */
  getTotalEvidenceCount(html: string): number {}
}
```

**Platform-Specific HTML Parsing**: The adapter uses platform-appropriate DOM APIs:
- **Browser**: Native `DOMParser` (zero dependencies)
- **Node.js**: `linkedom` or `jsdom` (adapter dev dependency, not core)

---

## 6. CLI Design

### 6.1 CLI Commands

```bash
# Main command
bio-cx2-to-rdf <input> [options]

# Options:
  -o, --output <file>          Output file (default: stdout)
  -u, --uuid <uuid>            Network UUID for provenance
  -b, --batch                  Batch process multiple files
  -v, --verbose                Verbose logging
  -q, --quiet                  Suppress progress indicators
  --validate                   Validate input CX2 structure
  --no-property-declarations   Skip okn:evidenceCount property declaration
  --pretty                     Pretty-print output
  --help                       Display help
  --version                    Display version

# Examples:
bio-cx2-to-rdf network.cx2
bio-cx2-to-rdf network.cx2 -o output.ttl
bio-cx2-to-rdf network.cx2 -u e5c9f6a2-3b1d-11ed-a261-0ac135e8bacf
bio-cx2-to-rdf *.cx2 --batch -o ./output/
```

### 6.2 CLI Implementation

```typescript
// src/cli/index.ts

import { Command } from 'commander';
import { CX2ToRDFConverter } from '../core/converter';

const program = new Command();

program
  .name('bio-cx2-to-rdf')
  .description('Convert Cytoscape CX2 networks to RDF Turtle format')
  .version('1.0.0')
  .argument('<input>', 'Input CX2 file or glob pattern')
  .option('-o, --output <file>', 'Output file (default: stdout)')
  .option('-u, --uuid <uuid>', 'Network UUID for provenance')
  .option('-b, --batch', 'Batch process multiple files')
  .option('-v, --verbose', 'Verbose logging')
  .option('-q, --quiet', 'Suppress progress indicators')
  .option('--validate', 'Validate input CX2 structure')
  .option('--no-property-declarations', 'Skip property declarations')
  .option('--pretty', 'Pretty-print output')
  .action(async (input, options) => {
    // Implementation
  });

program.parse();
```

---

## 7. Browser/Library Design

### 7.1 ES Module Export

```typescript
// src/browser/index.ts

export { CX2ToRDFConverter } from '../core/converter';
export type {
  ConversionOptions,
  ConversionResult,
  ConversionProgress
} from '../core/converter';

/**
 * Download RDF as file in browser
 */
export function downloadTurtleFile(
  turtle: string,
  filename: string
): void {
  const blob = new Blob([turtle], { type: 'text/turtle' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

### 7.2 React Hook (Optional)

```typescript
// src/browser/hooks/use-cx2-converter.ts

import { useState, useCallback } from 'react';
import { CX2ToRDFConverter } from '../../core/converter';
import type { ConversionOptions, ConversionResult } from '../../core/converter';

export interface UseCX2ConverterResult {
  convert: (cx2Data: any, options?: ConversionOptions) => Promise<ConversionResult>;
  isConverting: boolean;
  progress: number;
  error: Error | null;
  result: ConversionResult | null;
}

export function useCX2Converter(): UseCX2ConverterResult {
  const [isConverting, setIsConverting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  const [result, setResult] = useState<ConversionResult | null>(null);

  const convert = useCallback(async (cx2Data: any, options?: ConversionOptions) => {
    setIsConverting(true);
    setError(null);
    setProgress(0);

    try {
      const converter = new CX2ToRDFConverter();
      const result = await converter.convert(cx2Data, {
        ...options,
        onProgress: (p) => {
          setProgress((p.current / p.total) * 100);
        }
      });

      setResult(result);
      return result;
    } catch (err) {
      setError(err as Error);
      throw err;
    } finally {
      setIsConverting(false);
    }
  }, []);

  return { convert, isConverting, progress, error, result };
}
```

### 7.3 Cytoscape Web Integration Example

```typescript
// Example: Integrating into Cytoscape Web

import { CX2ToRDFConverter, downloadTurtleFile } from 'bio-cx2-to-rdf';

// In your Cytoscape Web component
class NetworkExporter {
  private converter = new CX2ToRDFConverter({
    includePropertyDeclarations: true
  });

  async exportToRDF(cy: any, networkUuid?: string) {
    // Get CX2 representation from Cytoscape.js
    const cx2Data = cy.json(); // Or cy.cx2() if available

    // Convert to RDF
    const result = await this.converter.convert(cx2Data, {
      networkUuid,
      onProgress: (progress) => {
        this.updateProgressBar(progress);
      }
    });

    // Download as file
    const filename = `${networkUuid || 'network'}.ttl`;
    downloadTurtleFile(result.turtle, filename);

    // Show success message
    this.showMessage(`Exported ${result.stats.tripleCount} triples`);
  }
}
```

---

## 8. Build Configuration

### 8.1 Package.json

```json
{
  "name": "bio-cx2-to-rdf",
  "version": "1.0.0",
  "description": "Convert Cytoscape CX2 networks to RDF Turtle format",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "bio-cx2-to-rdf": "./dist/cli/index.js"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./browser": {
      "types": "./dist/browser/index.d.ts",
      "import": "./dist/browser/index.js"
    },
    "./cli": {
      "types": "./dist/cli/index.d.ts",
      "import": "./dist/cli/index.js"
    }
  },
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ],
  "scripts": {
    "build": "npm run build:core && npm run build:cli && npm run build:browser",
    "build:core": "tsc -p tsconfig.json",
    "build:cli": "tsc -p tsconfig.cli.json",
    "build:browser": "vite build",
    "dev": "tsc -p tsconfig.json --watch",
    "test": "vitest",
    "test:coverage": "vitest --coverage",
    "lint": "eslint src/**/*.ts",
    "format": "prettier --write src/**/*.ts"
  },
  "dependencies": {
    "n3": "^1.17.2",
    "@rdfjs/namespace": "^2.0.0"
  },
  "optionalDependencies": {
    "linkedom": "^0.16.11"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "@types/n3": "^1.16.4",
    "linkedom": "^0.16.11",
    "typescript": "^5.3.3",
    "vitest": "^1.0.4",
    "vite": "^5.0.0",
    "commander": "^11.1.0",
    "chalk": "^5.3.0",
    "ora": "^7.0.1",
    "uuid": "^9.0.1",
    "@vitest/coverage-v8": "^1.0.4",
    "eslint": "^8.55.0",
    "prettier": "^3.1.0"
  },
  "peerDependencies": {
    "react": "^18.0.0"
  },
  "peerDependenciesMeta": {
    "react": {
      "optional": true
    }
  },
  "keywords": [
    "cytoscape",
    "cx2",
    "rdf",
    "turtle",
    "ontology",
    "semantic-web",
    "knowledge-graph",
    "nci-pid",
    "indra"
  ],
  "license": "MIT"
}
```

### 8.2 TypeScript Configurations

**Base Config (tsconfig.json)**:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020"],
    "moduleResolution": "bundler",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/core/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

**CLI Config (tsconfig.cli.json)**:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist/cli"
  },
  "include": ["src/cli/**/*", "src/core/**/*"]
}
```

**Browser Config (tsconfig.browser.json)**:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2020", "DOM"],
    "outDir": "./dist/browser"
  },
  "include": ["src/browser/**/*", "src/core/**/*"]
}
```

### 8.3 Vite Config (for browser builds)

```typescript
// vite.config.ts

import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/browser/index.ts'),
      name: 'CX2ToRDF',
      fileName: (format) => `browser/index.${format}.js`,
      formats: ['es', 'umd']
    },
    rollupOptions: {
      external: ['react', 'react-dom'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM'
        }
      }
    }
  }
});
```

---

## 9. Dependencies Breakdown

### 9.1 Core Dependencies (Required)

```json
{
  "n3": "^1.17.2",           // RDF library - platform agnostic, used everywhere
  "@rdfjs/namespace": "^2.0.0" // Namespace builder - platform agnostic
}
```

**Note**: Core has zero DOM/Node-specific dependencies to maintain platform agnosticism.

### 9.2 CLI Dependencies (Dev only, bundled)

```json
{
  "commander": "^11.1.0",    // CLI framework
  "chalk": "^5.3.0",         // Colored output
  "ora": "^7.0.1"            // Progress spinners
}
```

### 9.3 Adapter Dependencies (NCI-PID)

HTML parsing for NCI-PID adapter uses platform-appropriate APIs:

| Platform | Solution | Dependency |
|----------|----------|------------|
| Browser | Native `DOMParser` | None (built-in) |
| Node.js | `linkedom` | `linkedom: ^0.16.x` (lightweight, spec-compliant) |

```json
{
  "linkedom": "^0.16.11"     // Node.js HTML parsing (NCI-PID adapter only)
}
```

**Why linkedom over cheerio/jsdom?**
- Lighter weight than jsdom (~10x smaller)
- Spec-compliant DOM implementation
- Works with same code as browser `DOMParser`

### 9.4 Peer Dependencies (Optional)

```json
{
  "react": "^18.0.0"         // Only if using React hook
}
```

---

## 10. Implementation Phases

### Phase 1: Core Library Foundation (Week 1-2)
- [ ] Set up project structure
- [ ] Configure TypeScript, build tools
- [ ] Implement data models and types
- [ ] Implement CX2 parser (generic, platform-agnostic)
- [ ] Implement base adapter interface
- [ ] Write unit tests for core parsers

### Phase 1.5: NCI-PID Adapter (Week 2)
- [ ] Implement NCI-PID relationship parser (two-tier: URL params + text fallback)
- [ ] Implement INDRA type to RO/GO mapping
- [ ] Platform-agnostic HTML parsing (DOMParser/linkedom)
- [ ] Write unit tests for NCI-PID adapter

### Phase 1.6: Merged-Network Pathway Support (NCI-PID)
Handle merged NCI-PID networks that carry pathway provenance nodes and membership edges
(see [CX2_TO_RDF_DESIGN.md §4.8](CX2_TO_RDF_DESIGN.md)). Adds triples only; protein/edge/evidence
conversion and single-pathway files are unaffected.
- [ ] Type `type: "pathway"` nodes as `biolink:Pathway`; strip the filename version marker
      (e.g. ` _v2_0_`) from the name; mint `pathway:<slug|uuid>` (= `…/okn/pathway/…`) IRIs
      (discard the non-IRI `represents:"pathway:…"`); add `biolink:`/`PW:`/`pathway:` prefixes
      (only when pathway nodes exist) so terms compact (`PW:0000001`, `pathway:…`)
- [ ] Build the `proteinURI → {pathwayURI}` membership map from pathway nodes/edges
- [ ] Convert `interaction == "participates in"` edges to `protein RO:0000056 pathway` direct
      triples (flip pathway→protein to protein-subject; no reification)
- [ ] Attach `okn:inPathway` to each reified statement via endpoint intersection
      `pathways(subject) ∩ pathways(object)` (heuristic / co-membership-derived superset)
- [ ] Emit `biolink:Pathway owl:equivalentClass PW:0000001` and the `okn:inPathway` property axiom
- [ ] Verify evidence conversion unchanged; `small_example`/`Ephri_B` outputs stay byte-identical
- [ ] (Follow-up) exact edge→pathway provenance via per-edge source tracking in `merge_cx2.py`

### Phase 2: RDF Generation (Week 2-3)
- [ ] Implement namespace manager
- [ ] Implement URI builder
- [ ] Implement ontology mapper
- [ ] Implement Turtle writer (N3.js integration)
- [ ] Write unit tests for RDF components

### Phase 3: Processors (Week 3-4)
- [ ] Implement node processor
- [ ] Implement edge processor
- [ ] Implement metadata processor
- [ ] Implement main converter orchestrator
- [ ] Write integration tests

### Phase 4: CLI Tool (Week 4-5)
- [ ] Implement CLI commands (commander)
- [ ] Implement file I/O
- [ ] Implement progress indicators
- [ ] Implement batch processing
- [ ] Write CLI tests
- [ ] Create CLI documentation

### Phase 5: Browser/Library Support (Week 5-6)
- [ ] Configure browser build (Vite)
- [ ] Implement browser-specific utilities
- [ ] Implement React hook
- [ ] Create browser examples
- [ ] Test in Cytoscape Web
- [ ] Create integration documentation

### Phase 6: Testing & Documentation (Week 6-7)
- [ ] Comprehensive unit tests (80%+ coverage)
- [ ] Integration tests with real CX2 files
- [ ] Performance testing with large networks
- [ ] API documentation
- [ ] Usage examples
- [ ] README and guides

### Phase 7: Polish & Release (Week 7-8)
- [ ] Code review and refactoring
- [ ] Performance optimization
- [ ] Error handling improvements
- [ ] Finalize documentation
- [ ] Prepare for npm publish
- [ ] Create release notes

---

## 11. Testing Strategy

### 11.1 Unit Tests

```typescript
// tests/unit/parsers/html-parser.test.ts

import { describe, it, expect } from 'vitest';
import { HTMLRelationshipParser } from '../../../src/core/parsers/html-parser';

describe('HTMLRelationshipParser', () => {
  it('should parse simple binding relationship', () => {
    const html = '<li/>PIAS1 binds UBE2I(<a href="...">32</a>)';
    const parser = new HTMLRelationshipParser();
    const result = parser.parse(html);

    expect(result).toHaveLength(1);
    expect(result[0].subject).toBe('PIAS1');
    expect(result[0].predicate).toBe('binds');
    expect(result[0].object).toBe('UBE2I');
    expect(result[0].evidenceCount).toBe(32);
  });

  // More tests...
});
```

### 11.2 Integration Tests

```typescript
// tests/integration/converter.test.ts

import { describe, it, expect } from 'vitest';
import { CX2ToRDFConverter } from '../../src/core/converter';
import { readFileSync } from 'fs';

describe('CX2ToRDFConverter Integration', () => {
  it('should convert small example network', async () => {
    const cx2 = JSON.parse(
      readFileSync('./tests/fixtures/small_example.cx2', 'utf-8')
    );

    const converter = new CX2ToRDFConverter();
    const result = await converter.convert(cx2);

    // Uses standard RO predicates directly (no custom oknr: predicates)
    expect(result.turtle).toContain('RO:0002436');  // molecularly interacts with (binding)
    expect(result.turtle).toContain('RO:0002578');  // directly regulates (PTMs)
    expect(result.stats.nodeCount).toBe(16);
    expect(result.stats.edgeCount).toBe(58);
  });
});
```

### 11.3 Test Coverage Goals

- **Unit Tests**: 85%+ coverage
- **Integration Tests**: All major conversion paths
- **Performance Tests**: Networks up to 10,000 nodes
- **Browser Tests**: Manual testing in Cytoscape Web

---

## 12. Performance Considerations

### 12.1 Large File Handling

For networks with 1000+ nodes/edges:

```typescript
// Streaming API
const stream = converter.convertStream(cx2Data, options);

// In Node.js
stream.pipeTo(fs.createWriteStream('output.ttl'));

// In browser
const reader = stream.getReader();
let chunks = [];
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  chunks.push(value);
}
```

### 12.2 Optimization Strategies

- **Lazy parsing**: Parse HTML only when needed
- **Caching**: Cache node ID → URI mappings
- **Streaming**: Generate RDF incrementally
- **Worker threads**: Use Web Workers in browser for large conversions
- **Batching**: Process edges in batches of 100-500

### 12.3 Bundle Size Targets

- **Core library**: < 100 KB (minified + gzipped)
- **Browser bundle**: < 150 KB (minified + gzipped)
- **CLI binary**: No size limit (bundled with dependencies)

---

## 13. Deployment

### 13.1 NPM Package

```bash
# Install as CLI tool (global)
npm install -g bio-cx2-to-rdf

# Install as library (local)
npm install bio-cx2-to-rdf
```

### 13.2 Browser CDN

```html
<!-- ESM from CDN -->
<script type="module">
  import { CX2ToRDFConverter } from 'https://cdn.jsdelivr.net/npm/bio-cx2-to-rdf/+esm';
</script>

<!-- UMD from CDN -->
<script src="https://cdn.jsdelivr.net/npm/bio-cx2-to-rdf/dist/browser/index.umd.js"></script>
<script>
  const converter = new CX2ToRDF.CX2ToRDFConverter();
</script>
```

### 13.3 Cytoscape Web Integration

```bash
# In Cytoscape Web project
npm install bio-cx2-to-rdf
```

```typescript
// In your component
import { CX2ToRDFConverter, downloadTurtleFile } from 'bio-cx2-to-rdf/browser';
```

---

## 14. Future Enhancements

### 14.1 Short Term (Next 3 months)
- [ ] Support for additional CX2 attribute types
- [ ] SHACL shapes for RDF validation
- [ ] RDF/XML and JSON-LD output formats
- [ ] Performance benchmarks and optimization

### 14.2 Medium Term (6 months)
- [ ] GraphQL API for querying converted networks
- [ ] Integration with Blazegraph/Virtuoso for SPARQL endpoint
- [ ] Network comparison/diff in RDF
- [ ] Cytoscape.js plugin for direct RDF export

### 14.3 Long Term (12+ months)
- [ ] Bidirectional conversion (RDF → CX2)
- [ ] Support for other network formats (BioPAX, SBML)
- [ ] Federated queries across multiple networks
- [ ] Machine learning on RDF knowledge graphs

---

## 15. Success Metrics

### 15.1 Technical Metrics
- **Conversion accuracy**: 100% of valid CX2 files convert successfully
- **Performance**: < 1 second for networks with 100 nodes/edges
- **Test coverage**: > 85% code coverage
- **Bundle size**: < 150 KB for browser build

### 15.2 Adoption Metrics
- **NPM downloads**: 100+ downloads/month in first 3 months
- **GitHub stars**: 50+ stars in first 6 months
- **Integration**: Adopted in Cytoscape Web production build
- **Community**: 5+ external contributors in first year

---

## 16. Risk Assessment

### 16.1 Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| N3.js performance issues | Low | High | Profile and optimize, consider alternative RDF libraries |
| Browser compatibility | Medium | Medium | Comprehensive browser testing, polyfills if needed |
| Large file memory issues | Medium | High | Implement streaming API early |
| Ontology mapping errors | Low | Medium | Extensive validation against RO/GO specifications |

### 16.2 Project Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Scope creep | Medium | Medium | Strict adherence to implementation phases |
| Cytoscape Web API changes | Low | High | Close collaboration with Cytoscape team |
| Maintenance burden | Medium | Medium | Comprehensive documentation, automated testing |

---

## 17. Support and Maintenance

### 17.1 Documentation
- API reference (generated from TypeScript)
- CLI usage guide
- Cytoscape Web integration tutorial
- FAQ and troubleshooting guide

### 17.2 Issue Tracking
- GitHub Issues for bug reports
- GitHub Discussions for questions
- Regular releases (semantic versioning)
- Security vulnerability reporting

### 17.3 Community
- Contributing guidelines
- Code of conduct
- Developer setup guide
- Architecture documentation

---

## Next Steps

1. **Review this implementation plan** with stakeholders
2. **Set up development environment** (TypeScript, Vitest, etc.)
3. **Create initial project structure** following the layout above
4. **Begin Phase 1** implementation (Core Library Foundation)
5. **Establish weekly check-ins** to track progress

This implementation plan provides a comprehensive roadmap for building a production-ready CX2 to RDF converter that serves both standalone and Cytoscape Web use cases.
