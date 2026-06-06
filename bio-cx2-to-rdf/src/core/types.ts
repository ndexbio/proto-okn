/**
 * CX2 and RDF type definitions for bio-cx2-to-rdf
 */

import type { CX2Declarations } from './attribute-declarations.js';

// ============================================
// CX2 Types
// ============================================

/**
 * CX2 node structure.
 *
 * The `v` attribute bag is keyed by canonical full attribute names after the
 * parser's declaration-aware normalization (aliases resolved, defaults applied).
 */
export interface CX2Node {
  id: number;
  x?: number;
  y?: number;
  v: {
    name?: string;       // display label (gene symbol); alias "n" in some files
    represents?: string; // entity identifier (e.g., "uniprot:Q13547"); alias "r"
    type?: string;       // e.g., "protein"
    alias?: string[];    // alternative identifiers
    [key: string]: unknown;
  };
}

/**
 * CX2 edge structure.
 *
 * The `v` attribute bag is keyed by canonical full attribute names after the
 * parser's declaration-aware normalization (aliases resolved, defaults applied).
 */
export interface CX2Edge {
  id: number;
  s: number;             // source node id
  t: number;             // target node id
  v: {
    Relationships?: string;         // HTML string with INDRA evidence links
    interaction?: string;           // interaction type label; alias "i" in some files
    __edge_source?: string;         // e.g., "INDRA"
    __relationship_score?: number;
    __directed?: boolean;
    __reverse_directed?: boolean;
    [key: string]: unknown;
  };
}

/**
 * CX2 network attributes
 */
export interface CX2NetworkAttributes {
  name?: string;
  description?: string;
  version?: string;
  reference?: string;
  '@context'?: string;    // JSON string of namespace mappings
}

/**
 * Parsed @context namespace mapping
 */
export interface NamespaceMap {
  [prefix: string]: string;
}

/**
 * Complete parsed CX2 structure.
 *
 * Node/edge attributes are normalized to canonical full-name keys; `declarations`
 * holds the parsed attributeDeclarations that drove that normalization.
 */
export interface ParsedCX2 {
  nodes: CX2Node[];
  edges: CX2Edge[];
  networkAttributes: CX2NetworkAttributes;
  context: NamespaceMap;
  declarations: CX2Declarations;
  nodeIdToUri: Map<number, string>;
  nodeIdToName: Map<number, string>;
}

// ============================================
// Relationship Types
// ============================================

/**
 * Parsed relationship from INDRA evidence
 */
export interface ParsedRelationship {
  subject: string;           // gene/protein name
  predicate: string;         // action (e.g., "binds", "sumoylates")
  object: string;            // gene/protein name
  evidenceCount: number;
  evidenceUrl: string;
  indraType: string;         // INDRA statement type (e.g., "Complex", "Sumoylation")
}

/**
 * RDF mapping for an INDRA type
 */
export interface RdfMapping {
  predicate: string;         // RO predicate URI
  processType?: string;      // GO process type URI (optional)
}

// ============================================
// RDF Output Types
// ============================================

/**
 * RDF triple
 */
export interface RdfTriple {
  subject: string;
  predicate: string;
  object: string;
}

/**
 * Reified statement with metadata
 */
export interface ReifiedStatement {
  statementUri: string;
  subject: string;
  predicate: string;
  object: string;
  evidenceCount: number;
  evidenceUrl: string;
  processType?: string;
}

/**
 * Node declaration for RDF output
 */
export interface NodeDeclaration {
  uri: string;
  label: string;
  type: string;
  aliases?: string[];
}

/**
 * Complete RDF output structure
 */
export interface RdfOutput {
  namespaces: NamespaceMap;
  nodeDeclarations: NodeDeclaration[];
  directTriples: RdfTriple[];
  reifiedStatements: ReifiedStatement[];
}
