/**
 * RDF namespace handling
 */

import type { NamespaceMap } from './types.js';
import { BIOREGISTRY_PREFIXES } from './bioregistry-prefixes.js';

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
 * Canonicalize a network's @context prefixes against the vendored Bioregistry map.
 *
 * A prefix Bioregistry exposes with an RDF identity IRI (e.g. `uniprot` ->
 * `http://purl.uniprot.org/uniprot/`, `chebi` -> OBO) is rewritten to that
 * canonical stem; any prefix Bioregistry does not canonicalize keeps its original
 * @context value. This aligns entity IRIs with OKN-preferred identifiers without
 * a hand-maintained table. See `scripts/refresh-bioregistry.js`.
 */
export function canonicalizeContext(cx2Context: NamespaceMap): NamespaceMap {
  const out: NamespaceMap = {};
  for (const [prefix, uri] of Object.entries(cx2Context)) {
    out[prefix] = BIOREGISTRY_PREFIXES[prefix] ?? uri;
  }
  return out;
}

/**
 * Create merged namespace map from CX2 context and standard prefixes.
 * The @context is first canonicalized via Bioregistry.
 */
export function createNamespaceMap(cx2Context: NamespaceMap): NamespaceMap {
  // Standard prefixes take precedence to ensure consistency
  return {
    ...canonicalizeContext(cx2Context),
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
