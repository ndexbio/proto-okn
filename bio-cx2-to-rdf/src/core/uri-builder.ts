/**
 * URI construction utilities
 */

import type { NamespaceMap } from './types.js';
import { expandUri, resolvePrefix } from './namespace-manager.js';

/**
 * Characters RFC 3987 forbids in an IRI: control chars, space, and the
 * delimiters < > " { } | \ ^ `. Free-form values (e.g. INDRA evidence URLs)
 * can contain these and would produce invalid Turtle when emitted as IRIs.
 */
const IRI_FORBIDDEN = /[\x00-\x20<>"{}|\\^`]/g;

/**
 * Percent-encode only the IRI-illegal characters in an absolute IRI, leaving the
 * rest (including existing %XX escapes and `?`, `&`, `=`, `/`, `:`) untouched, so
 * the value stays a valid IRI that still dereferences and round-trips. Used at
 * serialization time for free-form URL-valued objects such as evidence URLs.
 */
export function toSafeIri(value: string): string {
  return value.replace(
    IRI_FORBIDDEN,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')
  );
}

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

  // Check if it contains a known prefix (case-insensitively — see resolvePrefix)
  const colonIndex = identifier.indexOf(':');
  if (colonIndex !== -1 && resolvePrefix(identifier.substring(0, colonIndex), namespaces)) {
    return expandUri(identifier, namespaces);
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
 * Biolink Model class for protein/gene family nodes ("protein family" is an
 * explicit alias of GeneFamily). Used to type CX2 `type: "proteinfamily"` nodes.
 */
export const BIOLINK_GENE_FAMILY = 'https://w3id.org/biolink/vocab/GeneFamily';

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
 * Mint an IRI for an entity whose CX2 `represents` is a bare name rather than a
 * resolvable CURIE — protein families the source never assigned an id (ETS, PLC,
 * PPAR), miRNA/lncRNA gene symbols (MIR34A, DLEU1), and one-off labels (LPS).
 *
 * Emitting the bare name produced a relative, scheme-less IRI (`<ACTR2>`), which
 * has no identity, cannot be dereferenced, and joins with nothing. A minted IRI
 * under the graph's own identifier base is a real subject; the entity keeps its
 * `rdfs:label`, so it stays findable by name.
 */
export function buildEntityUri(base: string, name: string): string {
  return `${base}entity/${slugify(name)}`;
}

/**
 * True when an identifier is a bare name — no CURIE prefix and no scheme — and so
 * needs a minted IRI.
 *
 * Deliberately tests for the *absence of a colon* rather than "does not resolve
 * against the namespace map". Some networks ship no `@context` at all (the IL3/4/5
 * NCI-PID exports), and treating their `uniprot:P42229` as unidentified would mint
 * `entity/uniprot-P42229` for a protein that has a perfectly good UniProt IRI. An
 * undeclared prefix is a namespace gap to be filled (see `createNamespaceMap`),
 * not an entity without an identifier.
 */
export function isBareName(identifier: string): boolean {
  return !identifier.includes(':');
}

/**
 * Deterministic 32-bit FNV-1a hash rendered as 8 hex chars. Dependency-free
 * (no node:crypto) so the core stays platform-agnostic; collision risk is
 * negligible at this scale (tens of families).
 */
function hash8(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Mint a protein/gene family IRI under the graph namespace.
 *
 * Identity is derived from the family's **member set** (normalized + sorted), so
 * families with identical membership converge to one IRI across pathways while
 * families that merely share a display name but differ in members stay distinct.
 * A readable name slug is prefixed for legibility. Falls back to a name-only IRI
 * when the family has no members.
 *
 * The CX2 `represents` of a family is a non-resolvable bare name (e.g.
 * "RAS family"), so it is intentionally not used as the IRI.
 */
export function buildFamilyUri(base: string, name: string, members?: string[]): string {
  const slug = slugify(name) || 'family';
  const normalized = (members ?? [])
    .map((m) => m.trim().toLowerCase())
    .filter((m) => m.length > 0)
    .sort();
  if (normalized.length === 0) {
    return `${base}family/${slug}`;
  }
  return `${base}family/${slug}-${hash8(normalized.join('|'))}`;
}

const OBO = 'http://purl.obolibrary.org/obo/';
const SIO = 'http://semanticscience.org/resource/SIO_';

/**
 * CX2 node `type` -> RDF class IRI (CX2_TO_RDF_DESIGN.md §4.2).
 *
 * Every term here has been checked against the ontology that defines it (SIO
 * release labels; OLS for OBO terms) — several IDs in earlier revisions of the
 * design table resolved to unrelated concepts (`SIO_010046` is "biological
 * entity", not protein complex; `SIO_000552` is the *property* "has parameter",
 * not signal). Verify a term before adding a row.
 *
 * Keys are lowercased at lookup, so legacy CamelCase types (`RnaReference`) and
 * ordinary lowercase types resolve through the same table.
 */
const NODE_TYPE_TO_CLASS: Record<string, string> = {
  protein: `${SIO}010043`,          // protein
  proteinfamily: `${SIO}001380`,    // protein family
  complex: `${SIO}010497`,          // protein complex
  antibody: `${SIO}010465`,         // antibody
  signal: `${SIO}010438`,           // signal
  gene: `${OBO}SO_0000704`,         // gene
  variant: `${OBO}SO_0001060`,      // sequence_variant
  mrna: `${OBO}SO_0000234`,         // mRNA
  mirna: `${OBO}SO_0000276`,        // miRNA
  lncrna: `${OBO}SO_0001877`,       // lncRNA
  // NCI-PID's legacy BioPAX type. Its members are miRNA (MIR34A, MIR17, …) and
  // lncRNA (DLEU1, DLEU2) genes, so the shared non-coding parent is the most
  // specific class that is true of all of them.
  rnareference: `${OBO}SO_0000655`, // ncRNA
  rna: `${OBO}CHEBI_33697`,         // ribonucleic acid
  smallmolecule: `${OBO}CHEBI_23367`, // molecular entity
  chemical: `${OBO}CHEBI_24431`,    // chemical entity
  drug: `${OBO}CHEBI_23888`,        // drug
  disease: `${OBO}MONDO_0000001`,   // disease
  phenotype: `${OBO}UPHENO_0001001`, // phenotype
  cellularcomponent: `${OBO}GO_0005575`,  // cellular_component
  biologicalprocess: `${OBO}GO_0008150`,  // biological_process
  molecularfunction: `${OBO}GO_0003674`,  // molecular_function
  tissue: `${OBO}UBERON_0000479`,   // tissue
  stimulus: `${OBO}NCIT_C41210`,    // Stimulus
};

/**
 * Map a CX2 node `type` to its RDF class IRI, or `undefined` when the type is
 * absent or unrecognized.
 *
 * There is deliberately **no default**. An earlier version fell back to protein
 * for every unmatched type, which silently published small molecules (cholesterol,
 * cAMP, 11-cis-retinal) as `SIO:010043`, so `?p a SIO:010043` returned chemicals.
 * CX2 already expresses "assume protein" declaratively — `attributeDeclarations`
 * carries `{"type": {"v": "protein"}}` and the parser materializes it — so a type
 * that reaches here unmatched is genuinely unknown and must not be guessed.
 */
export function nodeTypeToClassUri(nodeType: string | undefined): string | undefined {
  if (!nodeType) return undefined;
  return NODE_TYPE_TO_CLASS[nodeType.toLowerCase()];
}

/**
 * CURIE prefix -> class IRI, for identifier spaces whose membership *entails* a
 * class. UniProt contains only proteins and ChEBI only molecular entities, so
 * reading the class off the identifier is an entailment, not a guess.
 */
const IDENTIFIER_PREFIX_TO_CLASS: Record<string, string> = {
  uniprot: `${SIO}010043`,        // protein
  chebi: `${OBO}CHEBI_23367`,     // molecular entity
};

/**
 * Infer a class from the node's identifier when CX2 carries no usable `type`.
 *
 * This is NOT the old default-to-protein behaviour. That guessed from nothing and
 * mistyped every small molecule; this reads the class off the identifier space,
 * which only yields an answer when the space has a single kind of member. Nodes
 * whose prefix is not listed stay untyped.
 *
 * Needed because the merged NCI-PID networks omit the `{"type": {"v": "protein"}}`
 * declaration default that the per-pathway files carry, leaving 55 UniProt nodes
 * with no type at all — a gap in the merge, not a genuinely unknown entity.
 */
export function inferClassFromIdentifier(identifier: string | undefined): string | undefined {
  if (!identifier) return undefined;
  const colon = identifier.indexOf(':');
  if (colon === -1) return undefined;
  return IDENTIFIER_PREFIX_TO_CLASS[identifier.substring(0, colon).toLowerCase()];
}

/**
 * Check if identifier is a valid prefixed form
 */
export function isValidPrefixedUri(identifier: string, namespaces: NamespaceMap): boolean {
  const colonIndex = identifier.indexOf(':');
  if (colonIndex === -1) return false;

  return resolvePrefix(identifier.substring(0, colonIndex), namespaces) !== undefined;
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
