/**
 * RDF namespace handling
 */

import type { NamespaceMap } from './types.js';

/**
 * Standard RDF and ontology prefixes
 */
export const STANDARD_PREFIXES: NamespaceMap = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  owl: 'http://www.w3.org/2002/07/owl#',
  RO: 'http://purl.obolibrary.org/obo/RO_',
  GO: 'http://purl.obolibrary.org/obo/GO_',
  SIO: 'http://semanticscience.org/resource/SIO_',
  obo: 'http://purl.obolibrary.org/obo/',
  okn: 'http://example.org/okn/',
  indra: 'https://db.indra.bio/statements/',
};

/**
 * Create merged namespace map from CX2 context and standard prefixes
 */
export function createNamespaceMap(cx2Context: NamespaceMap): NamespaceMap {
  // Standard prefixes take precedence to ensure consistency
  return {
    ...cx2Context,
    ...STANDARD_PREFIXES,
  };
}

/**
 * Generate Turtle @prefix declarations
 */
export function generatePrefixDeclarations(namespaces: NamespaceMap): string {
  const lines: string[] = [];

  // Sort prefixes for consistent output
  const sortedPrefixes = Object.keys(namespaces).sort();

  for (const prefix of sortedPrefixes) {
    const uri = namespaces[prefix];
    lines.push(`@prefix ${prefix}: <${uri}> .`);
  }

  return lines.join('\n');
}

/**
 * Check if a URI uses a known prefix
 */
export function hasPrefix(uri: string, namespaces: NamespaceMap): boolean {
  const colonIndex = uri.indexOf(':');
  if (colonIndex === -1) return false;

  const prefix = uri.substring(0, colonIndex);
  return prefix in namespaces;
}

/**
 * Expand a prefixed URI to full URI
 */
export function expandUri(prefixedUri: string, namespaces: NamespaceMap): string {
  const colonIndex = prefixedUri.indexOf(':');
  if (colonIndex === -1) return prefixedUri;

  const prefix = prefixedUri.substring(0, colonIndex);
  const localPart = prefixedUri.substring(colonIndex + 1);

  if (prefix in namespaces) {
    return namespaces[prefix] + localPart;
  }

  return prefixedUri;
}

/**
 * Compact a full URI to prefixed form if possible
 */
export function compactUri(fullUri: string, namespaces: NamespaceMap): string {
  for (const [prefix, baseUri] of Object.entries(namespaces)) {
    if (fullUri.startsWith(baseUri)) {
      const localPart = fullUri.substring(baseUri.length);
      return `${prefix}:${localPart}`;
    }
  }
  return `<${fullUri}>`;
}
