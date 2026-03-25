/**
 * CX2 JSON parser
 * Parses CX2 format JSON array of aspects
 */

import type {
  CX2Node,
  CX2Edge,
  CX2NetworkAttributes,
  NamespaceMap,
  ParsedCX2,
} from './types.js';

/**
 * Parse CX2 JSON content
 * @param content - Raw JSON string of CX2 file
 * @returns Parsed CX2 structure
 */
export function parseCX2(content: string): ParsedCX2 {
  const aspects = JSON.parse(content) as unknown[];

  let nodes: CX2Node[] = [];
  let edges: CX2Edge[] = [];
  let networkAttributes: CX2NetworkAttributes = {};
  let context: NamespaceMap = {};

  // Iterate through aspects to extract relevant data
  for (const aspect of aspects) {
    if (typeof aspect !== 'object' || aspect === null) {
      continue;
    }

    const aspectObj = aspect as Record<string, unknown>;

    // Extract nodes
    if ('nodes' in aspectObj && Array.isArray(aspectObj.nodes)) {
      nodes = aspectObj.nodes as CX2Node[];
    }

    // Extract edges
    if ('edges' in aspectObj && Array.isArray(aspectObj.edges)) {
      edges = aspectObj.edges as CX2Edge[];
    }

    // Extract network attributes
    if ('networkAttributes' in aspectObj && Array.isArray(aspectObj.networkAttributes)) {
      const attrs = aspectObj.networkAttributes[0] as CX2NetworkAttributes;
      if (attrs) {
        networkAttributes = attrs;

        // Parse @context if present
        if (attrs['@context']) {
          try {
            context = JSON.parse(attrs['@context']) as NamespaceMap;
          } catch {
            console.warn('Failed to parse @context JSON');
          }
        }
      }
    }
  }

  // Build node ID lookup tables
  const nodeIdToUri = new Map<number, string>();
  const nodeIdToName = new Map<number, string>();

  for (const node of nodes) {
    nodeIdToUri.set(node.id, node.v.r);
    nodeIdToName.set(node.id, node.v.n);
  }

  return {
    nodes,
    edges,
    networkAttributes,
    context,
    nodeIdToUri,
    nodeIdToName,
  };
}

/**
 * Extract CX2 version from parsed content
 */
export function getCX2Version(content: string): string | null {
  const aspects = JSON.parse(content) as unknown[];

  for (const aspect of aspects) {
    if (typeof aspect === 'object' && aspect !== null) {
      const aspectObj = aspect as Record<string, unknown>;
      if ('CXVersion' in aspectObj) {
        return String(aspectObj.CXVersion);
      }
    }
  }

  return null;
}

/**
 * Get node counts from parsed CX2
 */
export function getNodeCount(parsed: ParsedCX2): number {
  return parsed.nodes.length;
}

/**
 * Get edge counts from parsed CX2
 */
export function getEdgeCount(parsed: ParsedCX2): number {
  return parsed.edges.length;
}
