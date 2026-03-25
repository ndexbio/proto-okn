/**
 * CX2 JSON parser
 * Parses CX2 format JSON array of aspects
 */
/**
 * Parse CX2 JSON content
 * @param content - Raw JSON string of CX2 file
 * @returns Parsed CX2 structure
 */
export function parseCX2(content) {
    const aspects = JSON.parse(content);
    let nodes = [];
    let edges = [];
    let networkAttributes = {};
    let context = {};
    // Iterate through aspects to extract relevant data
    for (const aspect of aspects) {
        if (typeof aspect !== 'object' || aspect === null) {
            continue;
        }
        const aspectObj = aspect;
        // Extract nodes
        if ('nodes' in aspectObj && Array.isArray(aspectObj.nodes)) {
            nodes = aspectObj.nodes;
        }
        // Extract edges
        if ('edges' in aspectObj && Array.isArray(aspectObj.edges)) {
            edges = aspectObj.edges;
        }
        // Extract network attributes
        if ('networkAttributes' in aspectObj && Array.isArray(aspectObj.networkAttributes)) {
            const attrs = aspectObj.networkAttributes[0];
            if (attrs) {
                networkAttributes = attrs;
                // Parse @context if present
                if (attrs['@context']) {
                    try {
                        context = JSON.parse(attrs['@context']);
                    }
                    catch {
                        console.warn('Failed to parse @context JSON');
                    }
                }
            }
        }
    }
    // Build node ID lookup tables
    const nodeIdToUri = new Map();
    const nodeIdToName = new Map();
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
export function getCX2Version(content) {
    const aspects = JSON.parse(content);
    for (const aspect of aspects) {
        if (typeof aspect === 'object' && aspect !== null) {
            const aspectObj = aspect;
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
export function getNodeCount(parsed) {
    return parsed.nodes.length;
}
/**
 * Get edge counts from parsed CX2
 */
export function getEdgeCount(parsed) {
    return parsed.edges.length;
}
//# sourceMappingURL=cx2-parser.js.map