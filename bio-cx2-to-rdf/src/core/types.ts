/**
 * CX2 and RDF type definitions for bio-cx2-to-rdf
 */

// ============================================
// CX2 Types
// ============================================

/**
 * CX2 node structure
 */
export interface CX2Node {
  id: number;
  x?: number;
  y?: number;
  v: {
    n: string;           // name
    r: string;           // represents (e.g., "uniprot:Q13547")
    type?: string;       // e.g., "protein"
    alias?: string[];    // alternative identifiers
  };
}

/**
 * CX2 edge structure
 */
export interface CX2Edge {
  id: number;
  s: number;             // source node id
  t: number;             // target node id
  v: {
    Relationships: string;          // HTML string with INDRA evidence links
    __edge_source?: string;         // e.g., "INDRA"
    __relationship_score?: number;
    __directed?: boolean;
    __reverse_directed?: boolean;
    i?: string;                     // interaction type label
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
 * Complete parsed CX2 structure
 */
export interface ParsedCX2 {
  nodes: CX2Node[];
  edges: CX2Edge[];
  networkAttributes: CX2NetworkAttributes;
  context: NamespaceMap;
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
