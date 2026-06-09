/**
 * URI construction utilities
 */

import type { NamespaceMap } from './types.js';
import { expandUri } from './namespace-manager.js';

/**
 * Parse a prefixed identifier and return full URI
 * @param identifier - Prefixed identifier like "uniprot:Q13547"
 * @param namespaces - Namespace map for expansion
 * @returns Full URI string
 */
export function buildUri(identifier: string, namespaces: NamespaceMap): string {
  // Check if it's already a full URI
  if (identifier.startsWith('http://') || identifier.startsWith('https://')) {
    return identifier;
  }

  // Check if it contains a known prefix
  const colonIndex = identifier.indexOf(':');
  if (colonIndex !== -1) {
    const prefix = identifier.substring(0, colonIndex);
    if (prefix in namespaces) {
      return expandUri(identifier, namespaces);
    }
  }

  // No known prefix - return as-is (might be a bare identifier)
  return identifier;
}

/**
 * Extract prefix and local part from identifier
 */
export function splitIdentifier(identifier: string): { prefix: string | null; local: string } {
  const colonIndex = identifier.indexOf(':');
  if (colonIndex === -1) {
    return { prefix: null, local: identifier };
  }

  return {
    prefix: identifier.substring(0, colonIndex),
    local: identifier.substring(colonIndex + 1),
  };
}

/**
 * Build a statement URI for reification
 */
export function buildStatementUri(
  baseUri: string,
  edgeId: number,
  relationshipIndex: number
): string {
  return `${baseUri}statement_${edgeId}_${relationshipIndex}`;
}

/**
 * Build RO predicate URI
 */
export function buildRoUri(roId: string): string {
  // Handle both formats: "RO:0002436" and "0002436"
  if (roId.startsWith('RO:')) {
    return `http://purl.obolibrary.org/obo/RO_${roId.substring(3)}`;
  }
  return `http://purl.obolibrary.org/obo/RO_${roId}`;
}

/**
 * Build GO term URI
 */
export function buildGoUri(goId: string): string {
  // Handle both formats: "GO:0006468" and "0006468"
  if (goId.startsWith('GO:')) {
    return `http://purl.obolibrary.org/obo/GO_${goId.substring(3)}`;
  }
  return `http://purl.obolibrary.org/obo/GO_${goId}`;
}

/**
 * Build SIO type URI (for protein, etc.)
 */
export function buildSioUri(sioId: string): string {
  // Handle both formats: "SIO:010043" and "010043"
  if (sioId.startsWith('SIO:')) {
    return `http://semanticscience.org/resource/SIO_${sioId.substring(4)}`;
  }
  return `http://semanticscience.org/resource/SIO_${sioId}`;
}

/**
 * Biolink Model class for pathway provenance nodes (merged networks)
 */
export const BIOLINK_PATHWAY = 'https://w3id.org/biolink/vocab/Pathway';

/**
 * Slugify a label into a URI-safe path segment
 */
export function slugify(text: string): string {
  return text
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Mint a pathway IRI under the graph namespace.
 * Prefers a stable NDEx UUID when available, otherwise a slug of the name.
 */
export function buildPathwayUri(base: string, name: string, uuid?: string): string {
  const id = uuid && uuid.trim() ? uuid.trim() : slugify(name);
  return `${base}pathway/${id}`;
}

/**
 * Map node type to SIO URI
 */
export function nodeTypeToSioUri(nodeType: string | undefined): string {
  const typeMap: Record<string, string> = {
    protein: 'http://semanticscience.org/resource/SIO_010043',
    gene: 'http://semanticscience.org/resource/SIO_010035',
    chemical: 'http://semanticscience.org/resource/SIO_010004',
    // Default to protein for NCI-PID
  };

  return typeMap[nodeType?.toLowerCase() ?? ''] ?? typeMap.protein;
}

/**
 * Check if identifier is a valid prefixed form
 */
export function isValidPrefixedUri(identifier: string, namespaces: NamespaceMap): boolean {
  const colonIndex = identifier.indexOf(':');
  if (colonIndex === -1) return false;

  const prefix = identifier.substring(0, colonIndex);
  return prefix in namespaces;
}

/**
 * Format URI for Turtle output
 * Returns prefixed form if available, otherwise full URI in angle brackets
 */
export function formatUriForTurtle(uri: string, namespaces: NamespaceMap): string {
  // Check if it's already prefixed
  const colonIndex = uri.indexOf(':');
  if (colonIndex !== -1 && !uri.startsWith('http')) {
    const prefix = uri.substring(0, colonIndex);
    if (prefix in namespaces) {
      return uri;  // Already in prefix:local form
    }
  }

  // For full URIs, try to compact
  for (const [prefix, baseUri] of Object.entries(namespaces)) {
    if (uri.startsWith(baseUri)) {
      const local = uri.substring(baseUri.length);
      return `${prefix}:${local}`;
    }
  }

  // Return as full URI in angle brackets
  return `<${uri}>`;
}
