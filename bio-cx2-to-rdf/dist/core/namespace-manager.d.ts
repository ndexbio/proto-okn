/**
 * RDF namespace handling
 */
import type { NamespaceMap } from './types.js';
/**
 * Standard RDF and ontology prefixes
 */
export declare const STANDARD_PREFIXES: NamespaceMap;
/**
 * Create merged namespace map from CX2 context and standard prefixes
 */
export declare function createNamespaceMap(cx2Context: NamespaceMap): NamespaceMap;
/**
 * Generate Turtle @prefix declarations
 */
export declare function generatePrefixDeclarations(namespaces: NamespaceMap): string;
/**
 * Check if a URI uses a known prefix
 */
export declare function hasPrefix(uri: string, namespaces: NamespaceMap): boolean;
/**
 * Expand a prefixed URI to full URI
 */
export declare function expandUri(prefixedUri: string, namespaces: NamespaceMap): string;
/**
 * Compact a full URI to prefixed form if possible
 */
export declare function compactUri(fullUri: string, namespaces: NamespaceMap): string;
//# sourceMappingURL=namespace-manager.d.ts.map