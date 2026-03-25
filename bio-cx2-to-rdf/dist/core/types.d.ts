/**
 * CX2 and RDF type definitions for bio-cx2-to-rdf
 */
/**
 * CX2 node structure
 */
export interface CX2Node {
    id: number;
    x?: number;
    y?: number;
    v: {
        n: string;
        r: string;
        type?: string;
        alias?: string[];
    };
}
/**
 * CX2 edge structure
 */
export interface CX2Edge {
    id: number;
    s: number;
    t: number;
    v: {
        Relationships: string;
        __edge_source?: string;
        __relationship_score?: number;
        __directed?: boolean;
        __reverse_directed?: boolean;
        i?: string;
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
    '@context'?: string;
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
/**
 * Parsed relationship from INDRA evidence
 */
export interface ParsedRelationship {
    subject: string;
    predicate: string;
    object: string;
    evidenceCount: number;
    evidenceUrl: string;
    indraType: string;
}
/**
 * RDF mapping for an INDRA type
 */
export interface RdfMapping {
    predicate: string;
    processType?: string;
}
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
//# sourceMappingURL=types.d.ts.map