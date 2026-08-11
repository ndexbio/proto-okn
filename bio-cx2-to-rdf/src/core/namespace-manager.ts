/**
 * RDF namespace handling
 */

import type { NamespaceMap } from './types.js';
import { BIOREGISTRY_PREFIXES } from './bioregistry-prefixes.js';

/**
 * Standard RDF and ontology prefixes
 */
/**
 * Base for entity IRIs this converter mints (statements, families, fallback
 * pathways) and for the vocabulary terms it defines.
 *
 * `http://example.org/` is reserved for documentation (RFC 6761) and must never
 * carry production identity. The NeST/IAS graphs already retired it in favour of
 * these two stems, and NCI-PID follows for consistency across our contributions:
 *   - entities   -> https://www.ndexbio.org/identifiers/
 *   - vocabulary -> https://www.ndexbio.org/vocab/ncipid/
 * See CX2_TO_RDF_DESIGN.md §1.1 and IAS_NETWORK_GENERATION.md §8.
 */
export const NDEX_IDENTIFIERS_BASE = 'https://www.ndexbio.org/identifiers/';
export const NDEX_VOCAB_BASE = 'https://www.ndexbio.org/vocab/ncipid/';

export const STANDARD_PREFIXES: NamespaceMap = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  owl: 'http://www.w3.org/2002/07/owl#',
  skos: 'http://www.w3.org/2004/02/skos/core#',
  RO: 'http://purl.obolibrary.org/obo/RO_',
  GO: 'http://purl.obolibrary.org/obo/GO_',
  SO: 'http://purl.obolibrary.org/obo/SO_',
  SIO: 'http://semanticscience.org/resource/SIO_',
  obo: 'http://purl.obolibrary.org/obo/',
  pubchem: 'http://rdf.ncbi.nlm.nih.gov/pubchem/compound/CID',
  ncipid: NDEX_IDENTIFIERS_BASE,
  ncipidv: NDEX_VOCAB_BASE,
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
  return {
    // Bioregistry-canonical stems for the identifier spaces NCI-PID nodes use,
    // as a floor. Some networks ship no `@context` at all (the IL3/4/5 exports),
    // and without this their `uniprot:`/`chebi:` CURIEs would resolve to nothing
    // and serialize as relative IRIs. A network that declares these prefixes
    // itself still overrides — after its own values are canonicalized, which
    // yields the same stems anyway.
    ...BIOREGISTRY_PREFIXES,
    ...canonicalizeContext(cx2Context),
    // Standard prefixes take precedence to ensure consistency
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
 * Look up a CURIE prefix in the namespace map, falling back to a case-insensitive
 * match when the exact case is absent.
 *
 * CX2 files are not internally consistent about prefix case: NCI-PID networks
 * declare `"chebi"` in `@context` but write `CHEBI:16618` on every node. An
 * exact-only lookup therefore failed for every ChEBI entity, and the CURIE was
 * emitted verbatim — producing relative, scheme-less IRIs like `<CHEBI:16618>`
 * that carry no identity and join with nothing. Exact match still wins, so a file
 * that legitimately declares both `chebi:` and `CHEBI:` keeps its distinction.
 */
export function resolvePrefix(prefix: string, namespaces: NamespaceMap): string | undefined {
  if (prefix in namespaces) return namespaces[prefix];
  const lower = prefix.toLowerCase();
  for (const [candidate, uri] of Object.entries(namespaces)) {
    if (candidate.toLowerCase() === lower) return uri;
  }
  return undefined;
}

/**
 * Check if a URI uses a known prefix
 */
export function hasPrefix(uri: string, namespaces: NamespaceMap): boolean {
  const colonIndex = uri.indexOf(':');
  if (colonIndex === -1) return false;

  return resolvePrefix(uri.substring(0, colonIndex), namespaces) !== undefined;
}

/**
 * Expand a prefixed URI to full URI
 */
export function expandUri(prefixedUri: string, namespaces: NamespaceMap): string {
  const colonIndex = prefixedUri.indexOf(':');
  if (colonIndex === -1) return prefixedUri;

  const prefix = prefixedUri.substring(0, colonIndex);
  const localPart = prefixedUri.substring(colonIndex + 1);

  const stem = resolvePrefix(prefix, namespaces);
  return stem !== undefined ? stem + localPart : prefixedUri;
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
