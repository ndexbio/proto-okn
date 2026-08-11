/**
 * NCI-PID Adapter Entry Point
 * Converts NCI-PID CX2 networks to RDF structures
 */

import type {
  ParsedCX2,
  CX2Edge,
  NodeDeclaration,
  ReifiedStatement,
  RdfTriple,
  RdfOutput,
  NamespaceMap,
} from '../../core/types.js';
import {
  createNamespaceMap,
  resolvePrefix,
  NDEX_IDENTIFIERS_BASE,
  NDEX_VOCAB_BASE,
} from '../../core/namespace-manager.js';
import {
  nodeTypeToClassUri,
  inferClassFromIdentifier,
  buildStatementUri,
  buildPathwayUri,
  buildFamilyUri,
  buildEntityUri,
  isBareName,
  buildUri,
  BIOLINK_PATHWAY,
  BIOLINK_GENE_FAMILY,
} from '../../core/uri-builder.js';
import { CHEMICAL_NORMALIZATION } from '../../core/chemical-normalization.js';
import { parseRelationships } from './relationship-parser.js';
import { getRdfMapping } from './indra-type-mapper.js';

/** Minted entity IRIs (statements, families, fallback pathways). */
const OKN_BASE_URI = NDEX_IDENTIFIERS_BASE;
/** Vocabulary terms this converter defines. */
const OKN_VOCAB_URI = NDEX_VOCAB_BASE;

const CHEMICAL_TYPE = 'smallmolecule';

// Pathway-provenance handling (merged NCI-PID networks). See CX2_TO_RDF_DESIGN.md §4.8.
const PATHWAY_TYPE = 'pathway';
const PARTICIPATES_IN_INTERACTION = 'participates in';
const RO_PARTICIPATES_IN = 'http://purl.obolibrary.org/obo/RO_0000056';
const OKN_IN_PATHWAY = `${OKN_VOCAB_URI}inPathway`;

// Protein/gene family handling. A family node's `member` list (hgnc.symbol CURIEs)
// becomes `family RO:0002351 gene` (has member) triples; biolink:has_member maps
// exactly to RO:0002351. See CX2_TO_RDF_DESIGN.md §4.9.
const PROTEIN_FAMILY_TYPE = 'proteinfamily';
const RO_HAS_MEMBER = 'http://purl.obolibrary.org/obo/RO_0002351';

// Schema axioms emitted once when a network contains pathway nodes
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const RDF_STATEMENT = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#Statement';
const RDFS_DOMAIN = 'http://www.w3.org/2000/01/rdf-schema#domain';
const RDFS_RANGE = 'http://www.w3.org/2000/01/rdf-schema#range';
const OWL_OBJECT_PROPERTY = 'http://www.w3.org/2002/07/owl#ObjectProperty';
const OWL_EQUIVALENT_CLASS = 'http://www.w3.org/2002/07/owl#equivalentClass';
const PW_PATHWAY = 'http://purl.obolibrary.org/obo/PW_0000001';

/**
 * Strip a trailing version marker left by the source filename when a merge
 * derives a pathway name from it, e.g. "… signaling events _v2_0_" -> "… signaling events".
 */
function cleanPathwayName(name: string): string {
  return name.replace(/\s*_v\d+(?:[._]\d+)*_?\s*$/i, '').trim();
}

/**
 * True when an identifier can be expanded to a real IRI: a full http(s) URL, or
 * a prefixed CURIE whose prefix is declared in the namespace map.
 */
function isResolvableIdentifier(identifier: string, namespaces: NamespaceMap): boolean {
  if (identifier.startsWith('http://') || identifier.startsWith('https://')) {
    return true;
  }
  const colon = identifier.indexOf(':');
  return colon !== -1 && resolvePrefix(identifier.substring(0, colon), namespaces) !== undefined;
}

/**
 * Add OKN provenance prefixes for tidy output, ordered so the most specific
 * prefix wins N3's first-match compaction:
 *  - `pathway:`/`family:` before `ncipid:` so those IRIs compact (the trailing slash
 *    is not a valid CURIE local-name char, so dedicated prefixes are required);
 *  - `PW:` before `obo:` so PW terms render as `PW:0000001` rather than `obo:PW_0000001`.
 * `biolink:` is added when either pathway or family nodes are present (both type
 * against the Biolink Model).
 */
function addOknPrefixes(
  ns: NamespaceMap,
  opts: { pathway: boolean; family: boolean }
): NamespaceMap {
  const needBiolink = opts.pathway || opts.family;
  const out: NamespaceMap = {};
  for (const [prefix, uri] of Object.entries(ns)) {
    if (prefix === 'obo' && opts.pathway) out.PW = 'http://purl.obolibrary.org/obo/PW_';
    if (prefix === 'ncipid') {
      if (opts.pathway) out.pathway = `${OKN_BASE_URI}pathway/`;
      if (opts.family) out.family = `${OKN_BASE_URI}family/`;
    }
    out[prefix] = uri;
    if (prefix === 'SIO' && needBiolink) out.biolink = 'https://w3id.org/biolink/vocab/';
  }
  // Fallbacks if the expected anchor prefixes were absent.
  if (needBiolink && !out.biolink) out.biolink = 'https://w3id.org/biolink/vocab/';
  if (opts.pathway && !out.PW) out.PW = 'http://purl.obolibrary.org/obo/PW_';
  if (opts.pathway && !out.pathway) out.pathway = `${OKN_BASE_URI}pathway/`;
  if (opts.family && !out.family) out.family = `${OKN_BASE_URI}family/`;
  return out;
}

/**
 * Convert parsed CX2 to RDF output structure
 */
export function convertToRdf(parsed: ParsedCX2): RdfOutput {
  let namespaces = createNamespaceMap(parsed.context);
  const { nodeDeclarations, pathwayUriByNodeId, familyTriples } = processNodes(parsed, namespaces);
  const { directTriples, reifiedStatements } = processEdges(parsed, pathwayUriByNodeId);

  // Family member triples (family RO:0002351 gene) are emitted as direct triples.
  directTriples.push(...familyTriples);

  const hasPathwayNodes = pathwayUriByNodeId.size > 0;
  const hasFamilyNodes = familyTriples.length > 0;

  // Add OKN provenance prefixes only when the corresponding nodes exist, so a
  // network without pathway/family nodes keeps an unchanged prefix block.
  if (hasPathwayNodes || hasFamilyNodes) {
    namespaces = addOknPrefixes(namespaces, { pathway: hasPathwayNodes, family: hasFamilyNodes });
  }

  // Schema axioms for pathway provenance, emitted once when pathway nodes exist
  // (biolink:Pathway ↔ PW:0000001 mapping; okn:inPathway property declaration).
  if (hasPathwayNodes) {
    directTriples.push(
      { subject: BIOLINK_PATHWAY, predicate: OWL_EQUIVALENT_CLASS, object: PW_PATHWAY },
      { subject: OKN_IN_PATHWAY, predicate: RDF_TYPE, object: OWL_OBJECT_PROPERTY },
      { subject: OKN_IN_PATHWAY, predicate: RDFS_DOMAIN, object: RDF_STATEMENT },
      { subject: OKN_IN_PATHWAY, predicate: RDFS_RANGE, object: BIOLINK_PATHWAY },
    );
  }

  return {
    namespaces,
    // Merge node declarations that share an IRI (e.g. paralogs CALM1/2/3 all
    // declared as uniprot:P02593) so type/label/sameAs are not emitted per copy.
    nodeDeclarations: dedupeDeclarations(nodeDeclarations),
    // RDF is a set: collapse identical (s,p,o) direct triples (e.g. several
    // INDRA relationships in one edge resolving to the same family endpoint).
    // Reified statements are intentionally NOT deduped — each carries distinct
    // per-evidence provenance, so the collapsed direct triple stays recoverable.
    directTriples: dedupeTriples(directTriples),
    reifiedStatements,
  };
}

/**
 * Order-preserving dedup of direct triples by (subject, predicate, object).
 */
function dedupeTriples(triples: RdfTriple[]): RdfTriple[] {
  const seen = new Set<string>();
  const out: RdfTriple[] = [];
  for (const t of triples) {
    const key = `${t.subject}\t${t.predicate}\t${t.object}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}

/**
 * Merge node declarations sharing the same IRI into one (first label/type wins,
 * aliases unioned), and drop any alias that equals the node's own IRI (a no-op
 * `owl:sameAs` self-reference). Multiple CX2 nodes can map to one IRI — e.g.
 * paralogs sharing a UniProt accession — and are a single RDF node.
 */
function dedupeDeclarations(decls: NodeDeclaration[]): NodeDeclaration[] {
  const byUri = new Map<string, NodeDeclaration>();
  for (const d of decls) {
    const existing = byUri.get(d.uri);
    if (!existing) {
      byUri.set(d.uri, { ...d, aliases: d.aliases ? [...d.aliases] : undefined });
      continue;
    }
    if (!existing.label && d.label) existing.label = d.label;
    if (d.aliases?.length) {
      const merged = new Set(existing.aliases ?? []);
      for (const a of d.aliases) merged.add(a);
      existing.aliases = [...merged];
    }
  }
  for (const d of byUri.values()) {
    if (d.aliases) {
      const filtered = d.aliases.filter((a) => a !== d.uri);
      d.aliases = filtered.length ? filtered : undefined;
    }
  }
  return [...byUri.values()];
}

/**
 * Process CX2 nodes to node declarations.
 * Also returns the minted pathway IRI for each pathway-provenance node (used to
 * convert membership edges, see processEdges) and the family member triples.
 */
function processNodes(parsed: ParsedCX2, namespaces: NamespaceMap): {
  nodeDeclarations: NodeDeclaration[];
  pathwayUriByNodeId: Map<number, string>;
  familyTriples: RdfTriple[];
} {
  const declarations: NodeDeclaration[] = [];
  const pathwayUriByNodeId = new Map<number, string>();
  const familyTriples: RdfTriple[] = [];

  for (const node of parsed.nodes) {
    // Protein/gene family nodes: the CX2 `represents` is a non-resolvable bare
    // name (e.g. "RAS family"), so mint a stable IRI from the member set and type
    // as biolink:GeneFamily. The `member` list (hgnc.symbol CURIEs) becomes
    // `family RO:0002351 gene` (has member). The minted IRI replaces this node's
    // entry in nodeIdToUri so interaction edges to the family resolve to it too.
    if (node.v.type?.toLowerCase() === PROTEIN_FAMILY_TYPE) {
      const name = node.v.name;
      if (!name) {
        console.warn(`Skipping family node ${node.id}: missing name`);
        continue;
      }
      const members = Array.isArray(node.v.member)
        ? node.v.member.filter((m): m is string => typeof m === 'string')
        : [];
      const uri = buildFamilyUri(OKN_BASE_URI, name, members);
      parsed.nodeIdToUri.set(node.id, uri);
      declarations.push({ uri, label: name, type: BIOLINK_GENE_FAMILY });
      for (const member of members) {
        familyTriples.push({ subject: uri, predicate: RO_HAS_MEMBER, object: member });
      }
      continue;
    }

    // Pathway-provenance nodes (merged networks): type as biolink:Pathway. Prefer
    // the node's own `represents` as the IRI — a merged network sets it to the
    // source NDEx network (e.g. "ndex:<uuid>"), which resolves through the
    // network @context. Fall back to a minted okn:pathway/<slug|uuid> IRI only
    // when `represents` is absent or its prefix is undeclared (e.g. the merge's
    // non-resolvable "pathway:<name>" placeholder emitted with no NDEx UUID).
    if (node.v.type?.toLowerCase() === PATHWAY_TYPE) {
      const name = node.v.name;
      if (!name) {
        console.warn(`Skipping pathway node ${node.id}: missing name`);
        continue;
      }
      const cleanName = cleanPathwayName(name);
      const represents =
        typeof node.v.represents === 'string' ? node.v.represents.trim() : '';
      let uri: string;
      if (represents && isResolvableIdentifier(represents, namespaces)) {
        uri = buildUri(represents, namespaces);
      } else {
        const uuid = typeof node.v.uuid === 'string' ? node.v.uuid : undefined;
        uri = buildPathwayUri(OKN_BASE_URI, cleanName, uuid);
      }
      pathwayUriByNodeId.set(node.id, uri);
      declarations.push({ uri, label: cleanName, type: BIOLINK_PATHWAY });
      continue;
    }

    // A node without a `represents` identifier cannot form a valid RDF subject
    // URI; skip it rather than emit an empty IRI (which would crash the writer).
    if (!node.v.represents) {
      console.warn(`Skipping node ${node.id}: missing 'represents' identifier`);
      continue;
    }

    // Declared type first; then the identifier space, which entails a class for
    // uniprot/chebi. No blanket default — guessing a class from nothing is how
    // small molecules came to be published as proteins.
    const type =
      nodeTypeToClassUri(node.v.type) ?? inferClassFromIdentifier(node.v.represents);
    if (!type) {
      console.warn(
        `Node ${node.id} (${node.v.represents}): type ${JSON.stringify(node.v.type)} ` +
          `unrecognized and identifier implies no class — emitting without rdf:type`
      );
    }

    // Small molecules are re-identified onto the OKN-preferred identifier
    // (PubChem CID, else ChEBI) from the vendored normalization snapshot; the rest
    // of the clique becomes skos:exactMatch. Identifiers absent from the map have
    // nothing better to point at and keep their source IRI.
    const normalized =
      node.v.type?.toLowerCase() === CHEMICAL_TYPE
        ? CHEMICAL_NORMALIZATION[node.v.represents]
        : undefined;

    // A bare-name `represents` cannot form a real IRI; mint one under the graph's
    // identifier base so the entity has an identity instead of a relative IRI.
    const minted = isBareName(node.v.represents)
      ? buildEntityUri(OKN_BASE_URI, node.v.represents)
      : undefined;

    const subjectUri = normalized?.iri ?? minted;
    if (subjectUri) {
      parsed.nodeIdToUri.set(node.id, subjectUri);
    }

    // The subject IRI moved, so record the identifier it moved from — otherwise a
    // consumer holding the source ChEBI/CAS id can no longer reach this entity.
    // Resolved here rather than in the snapshot because only the network's own
    // @context knows the stem for prefixes Bioregistry does not canonicalize (cas).
    const exactMatch = normalized
      ? [...new Set([...normalized.exactMatch, buildUri(node.v.represents, namespaces)])]
          .filter((iri) => iri !== normalized.iri)
      : undefined;

    declarations.push({
      uri: subjectUri ?? node.v.represents,
      label: node.v.name,
      type,
      aliases: node.v.alias,
      exactMatch: exactMatch?.length ? exactMatch : undefined,
    });
  }

  return { nodeDeclarations: declarations, pathwayUriByNodeId, familyTriples };
}

/**
 * Process CX2 edges to RDF triples and reified statements.
 *
 * Two passes:
 *  A. Pathway-membership edges (`interaction == "participates in"`) → `protein
 *     RO:0000056 pathway` direct triples, and a protein→pathways map.
 *  B. INDRA evidence edges → direct triples + reified statements, each tagged
 *     with `okn:inPathway` for every pathway both endpoints participate in.
 */
function processEdges(
  parsed: ParsedCX2,
  pathwayUriByNodeId: Map<number, string>,
): {
  directTriples: RdfTriple[];
  reifiedStatements: ReifiedStatement[];
} {
  const directTriples: RdfTriple[] = [];
  const reifiedStatements: ReifiedStatement[] = [];

  // Pass A: membership edges → participates_in triples + protein→pathways map
  const pathwaysByProtein = new Map<string, Set<string>>();
  const indraEdges: CX2Edge[] = [];

  for (const edge of parsed.edges) {
    if (edge.v.interaction === PARTICIPATES_IN_INTERACTION) {
      handleMembershipEdge(edge, parsed, pathwayUriByNodeId, directTriples, pathwaysByProtein);
    } else {
      indraEdges.push(edge);
    }
  }

  // Pass B: INDRA evidence edges
  for (const edge of indraEdges) {
    const sourceUri = parsed.nodeIdToUri.get(edge.s);
    const targetUri = parsed.nodeIdToUri.get(edge.t);

    if (!sourceUri || !targetUri) {
      console.warn(`Skipping edge ${edge.id}: missing node URIs`);
      continue;
    }

    // Parse relationships from HTML (edges without a Relationships field yield none)
    const relationships = parseRelationships(edge.v.Relationships ?? '');

    for (let i = 0; i < relationships.length; i++) {
      const rel = relationships[i];
      const mapping = getRdfMapping(rel.indraType);

      // Determine actual subject/object URIs based on parsed relationship
      // The relationship subject/object are gene names, need to match to node URIs
      const subjectUri = findNodeUriByName(parsed, rel.subject) ?? sourceUri;
      const objectUri = findNodeUriByName(parsed, rel.object) ?? targetUri;

      // Drop self-loops: a relationship whose subject and object resolve to the
      // same IRI (e.g. family-internal interactions, or member gene names that
      // fall back to the same family endpoint) carries no relational information.
      if (subjectUri === objectUri) {
        continue;
      }

      // Add direct triple
      directTriples.push({
        subject: subjectUri,
        predicate: mapping.predicate,
        object: objectUri,
      });

      // Pathway membership of this interaction: pathways both endpoints share
      const inPathways = intersectPathways(pathwaysByProtein, subjectUri, objectUri);

      // Add reified statement with metadata
      const statementUri = buildStatementUri(OKN_BASE_URI, edge.id, i);
      reifiedStatements.push({
        statementUri,
        subject: subjectUri,
        predicate: mapping.predicate,
        object: objectUri,
        evidenceCount: rel.evidenceCount,
        evidenceUrl: rel.evidenceUrl,
        processType: mapping.processType,
        inPathways: inPathways.length > 0 ? inPathways : undefined,
      });
    }
  }

  return { directTriples, reifiedStatements };
}

/**
 * Convert a pathway-membership edge (pathway → protein) into a
 * `protein RO:0000056 pathway` triple and record the membership.
 */
function handleMembershipEdge(
  edge: CX2Edge,
  parsed: ParsedCX2,
  pathwayUriByNodeId: Map<number, string>,
  directTriples: RdfTriple[],
  pathwaysByProtein: Map<string, Set<string>>,
): void {
  // One endpoint is the pathway node, the other the participating protein.
  let pathwayNodeId: number | undefined;
  let proteinNodeId: number | undefined;
  if (pathwayUriByNodeId.has(edge.s)) {
    pathwayNodeId = edge.s;
    proteinNodeId = edge.t;
  } else if (pathwayUriByNodeId.has(edge.t)) {
    pathwayNodeId = edge.t;
    proteinNodeId = edge.s;
  }

  if (pathwayNodeId === undefined || proteinNodeId === undefined) {
    console.warn(`Skipping membership edge ${edge.id}: no pathway endpoint`);
    return;
  }

  const pathwayUri = pathwayUriByNodeId.get(pathwayNodeId)!;
  const proteinUri = parsed.nodeIdToUri.get(proteinNodeId);
  if (!proteinUri) {
    console.warn(`Skipping membership edge ${edge.id}: protein node ${proteinNodeId} has no URI`);
    return;
  }

  // protein participates_in pathway (flip the pathway→protein direction)
  directTriples.push({
    subject: proteinUri,
    predicate: RO_PARTICIPATES_IN,
    object: pathwayUri,
  });

  let set = pathwaysByProtein.get(proteinUri);
  if (!set) {
    set = new Set<string>();
    pathwaysByProtein.set(proteinUri, set);
  }
  set.add(pathwayUri);
}

/**
 * Pathways shared by two proteins (intersection of their membership sets).
 */
function intersectPathways(
  pathwaysByProtein: Map<string, Set<string>>,
  a: string,
  b: string,
): string[] {
  const sa = pathwaysByProtein.get(a);
  const sb = pathwaysByProtein.get(b);
  if (!sa || !sb) return [];
  const shared: string[] = [];
  for (const p of sa) {
    if (sb.has(p)) shared.push(p);
  }
  return shared;
}

/**
 * Find node URI by gene/protein name. Reads through nodeIdToUri so minted IRIs
 * (e.g. a family node's member-derived IRI) win over the raw bare-name represents.
 */
function findNodeUriByName(parsed: ParsedCX2, name: string): string | undefined {
  for (const node of parsed.nodes) {
    if (node.v.name === name) {
      return parsed.nodeIdToUri.get(node.id) ?? node.v.represents;
    }
  }
  return undefined;
}

// Re-export submodule functions for convenience
export { parseRelationships, getTotalEvidenceCount } from './relationship-parser.js';
export { getRdfMapping, getPredicateUri, getProcessTypeUri } from './indra-type-mapper.js';
