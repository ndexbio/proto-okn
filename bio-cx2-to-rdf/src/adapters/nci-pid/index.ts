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
import { createNamespaceMap } from '../../core/namespace-manager.js';
import {
  nodeTypeToSioUri,
  buildStatementUri,
  buildPathwayUri,
  BIOLINK_PATHWAY,
} from '../../core/uri-builder.js';
import { parseRelationships } from './relationship-parser.js';
import { getRdfMapping } from './indra-type-mapper.js';

const OKN_BASE_URI = 'http://example.org/okn/';

// Pathway-provenance handling (merged NCI-PID networks). See CX2_TO_RDF_DESIGN.md §4.8.
const PATHWAY_TYPE = 'pathway';
const PARTICIPATES_IN_INTERACTION = 'participates in';
const RO_PARTICIPATES_IN = 'http://purl.obolibrary.org/obo/RO_0000056';
const OKN_IN_PATHWAY = `${OKN_BASE_URI}inPathway`;

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
 * Add pathway-related prefixes for tidy output, ordered so the most specific
 * prefix wins N3's first-match compaction:
 *  - `pathway:` before `okn:` so pathway IRIs compact (the trailing slash is not a
 *    valid CURIE local-name char, so a dedicated prefix is required);
 *  - `PW:` before `obo:` so PW terms render as `PW:0000001` rather than `obo:PW_0000001`.
 */
function addPathwayPrefixes(ns: NamespaceMap): NamespaceMap {
  const out: NamespaceMap = {};
  for (const [prefix, uri] of Object.entries(ns)) {
    if (prefix === 'obo') out.PW = 'http://purl.obolibrary.org/obo/PW_';
    if (prefix === 'okn') out.pathway = `${OKN_BASE_URI}pathway/`;
    out[prefix] = uri;
    if (prefix === 'SIO') out.biolink = 'https://w3id.org/biolink/vocab/';
  }
  // Fallbacks if the expected anchor prefixes were absent.
  if (!out.PW) out.PW = 'http://purl.obolibrary.org/obo/PW_';
  if (!out.biolink) out.biolink = 'https://w3id.org/biolink/vocab/';
  if (!out.pathway) out.pathway = `${OKN_BASE_URI}pathway/`;
  return out;
}

/**
 * Convert parsed CX2 to RDF output structure
 */
export function convertToRdf(parsed: ParsedCX2): RdfOutput {
  let namespaces = createNamespaceMap(parsed.context);
  const { nodeDeclarations, pathwayUriByNodeId } = processNodes(parsed);
  const { directTriples, reifiedStatements } = processEdges(parsed, pathwayUriByNodeId);

  // Schema axioms for pathway provenance, emitted once when pathway nodes exist
  // (biolink:Pathway ↔ PW:0000001 mapping; okn:inPathway property declaration).
  // The pathway-related prefixes are added only here so pathway-free networks keep
  // an unchanged prefix block.
  if (pathwayUriByNodeId.size > 0) {
    namespaces = addPathwayPrefixes(namespaces);
    directTriples.push(
      { subject: BIOLINK_PATHWAY, predicate: OWL_EQUIVALENT_CLASS, object: PW_PATHWAY },
      { subject: OKN_IN_PATHWAY, predicate: RDF_TYPE, object: OWL_OBJECT_PROPERTY },
      { subject: OKN_IN_PATHWAY, predicate: RDFS_DOMAIN, object: RDF_STATEMENT },
      { subject: OKN_IN_PATHWAY, predicate: RDFS_RANGE, object: BIOLINK_PATHWAY },
    );
  }

  return {
    namespaces,
    nodeDeclarations,
    directTriples,
    reifiedStatements,
  };
}

/**
 * Process CX2 nodes to node declarations.
 * Also returns the minted pathway IRI for each pathway-provenance node, used to
 * convert membership edges (see processEdges).
 */
function processNodes(parsed: ParsedCX2): {
  nodeDeclarations: NodeDeclaration[];
  pathwayUriByNodeId: Map<number, string>;
} {
  const declarations: NodeDeclaration[] = [];
  const pathwayUriByNodeId = new Map<number, string>();

  for (const node of parsed.nodes) {
    // Pathway-provenance nodes (merged networks): mint a real IRI and type as
    // biolink:Pathway. The CX2 `represents` value (e.g. "pathway:IL5-…") is not
    // a valid IRI and is discarded in favor of okn:pathway/<slug|uuid>.
    if (node.v.type?.toLowerCase() === PATHWAY_TYPE) {
      const name = node.v.name;
      if (!name) {
        console.warn(`Skipping pathway node ${node.id}: missing name`);
        continue;
      }
      const uuid = typeof node.v.uuid === 'string' ? node.v.uuid : undefined;
      const cleanName = cleanPathwayName(name);
      const uri = buildPathwayUri(OKN_BASE_URI, cleanName, uuid);
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

    declarations.push({
      uri: node.v.represents,
      label: node.v.name,
      type: nodeTypeToSioUri(node.v.type),
      aliases: node.v.alias,
    });
  }

  return { nodeDeclarations: declarations, pathwayUriByNodeId };
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
 * Find node URI by gene/protein name
 */
function findNodeUriByName(parsed: ParsedCX2, name: string): string | undefined {
  for (const node of parsed.nodes) {
    if (node.v.name === name) {
      return node.v.represents;
    }
  }
  return undefined;
}

// Re-export submodule functions for convenience
export { parseRelationships, getTotalEvidenceCount } from './relationship-parser.js';
export { getRdfMapping, getPredicateUri, getProcessTypeUri } from './indra-type-mapper.js';
