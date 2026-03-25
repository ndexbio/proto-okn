/**
 * URI construction utilities
 */
import type { NamespaceMap } from './types.js';
/**
 * Parse a prefixed identifier and return full URI
 * @param identifier - Prefixed identifier like "uniprot:Q13547"
 * @param namespaces - Namespace map for expansion
 * @returns Full URI string
 */
export declare function buildUri(identifier: string, namespaces: NamespaceMap): string;
/**
 * Extract prefix and local part from identifier
 */
export declare function splitIdentifier(identifier: string): {
    prefix: string | null;
    local: string;
};
/**
 * Build a statement URI for reification
 */
export declare function buildStatementUri(baseUri: string, edgeId: number, relationshipIndex: number): string;
/**
 * Build RO predicate URI
 */
export declare function buildRoUri(roId: string): string;
/**
 * Build GO term URI
 */
export declare function buildGoUri(goId: string): string;
/**
 * Build SIO type URI (for protein, etc.)
 */
export declare function buildSioUri(sioId: string): string;
/**
 * Map node type to SIO URI
 */
export declare function nodeTypeToSioUri(nodeType: string | undefined): string;
/**
 * Check if identifier is a valid prefixed form
 */
export declare function isValidPrefixedUri(identifier: string, namespaces: NamespaceMap): boolean;
/**
 * Format URI for Turtle output
 * Returns prefixed form if available, otherwise full URI in angle brackets
 */
export declare function formatUriForTurtle(uri: string, namespaces: NamespaceMap): string;
//# sourceMappingURL=uri-builder.d.ts.map