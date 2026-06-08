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
import {
  parseAttributeDeclarations,
  normalizeAttributes,
} from './attribute-declarations.js';

/**
 * Parse CX2 JSON content
 * @param content - Raw JSON string of CX2 file
 * @returns Parsed CX2 structure
 */
export function parseCX2(content: string): ParsedCX2 {
  const aspects = JSON.parse(content) as unknown[];

  // Parse attribute declarations first so node/edge/network attributes can be
  // normalized to canonical full-name keys (aliases resolved, defaults applied).
  const declarations = parseAttributeDeclarations(aspects);

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

    // Extract nodes (normalize each node's attribute bag)
    if ('nodes' in aspectObj && Array.isArray(aspectObj.nodes)) {
      nodes = (aspectObj.nodes as CX2Node[]).map((node) => ({
        ...node,
        v: normalizeAttributes(node.v, declarations.nodes) as CX2Node['v'],
      }));
    }

    // Extract edges (normalize each edge's attribute bag)
    if ('edges' in aspectObj && Array.isArray(aspectObj.edges)) {
      edges = (aspectObj.edges as CX2Edge[]).map((edge) => ({
        ...edge,
        v: normalizeAttributes(edge.v, declarations.edges) as CX2Edge['v'],
      }));
    }

    // Extract network attributes
    if ('networkAttributes' in aspectObj && Array.isArray(aspectObj.networkAttributes)) {
      const rawAttrs = aspectObj.networkAttributes[0] as Record<string, unknown> | undefined;
      if (rawAttrs) {
        // Apply declared defaults (aliases are not permitted for networkAttributes)
        networkAttributes = normalizeAttributes(
          rawAttrs,
          declarations.networkAttributes
        ) as CX2NetworkAttributes;

        // Parse @context if present
        if (networkAttributes['@context']) {
          try {
            context = JSON.parse(networkAttributes['@context']) as NamespaceMap;
          } catch {
            console.warn('Failed to parse @context JSON');
          }
        }
      }
    }
  }

  // Build node ID lookup tables from canonical (normalized) attribute names
  const nodeIdToUri = new Map<number, string>();
  const nodeIdToName = new Map<number, string>();

  for (const node of nodes) {
    if (node.v.represents !== undefined) {
      nodeIdToUri.set(node.id, node.v.represents);
    }
    if (node.v.name !== undefined) {
      nodeIdToName.set(node.id, node.v.name);
    }
  }

  return {
    nodes,
    edges,
    networkAttributes,
    context,
    declarations,
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
