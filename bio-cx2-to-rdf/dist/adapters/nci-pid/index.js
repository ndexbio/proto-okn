/**
 * NCI-PID Adapter Entry Point
 * Converts NCI-PID CX2 networks to RDF structures
 */
import { createNamespaceMap } from '../../core/namespace-manager.js';
import { nodeTypeToSioUri, buildStatementUri } from '../../core/uri-builder.js';
import { parseRelationships } from './relationship-parser.js';
import { getRdfMapping } from './indra-type-mapper.js';
const OKN_BASE_URI = 'http://example.org/okn/';
/**
 * Convert parsed CX2 to RDF output structure
 */
export function convertToRdf(parsed) {
    const namespaces = createNamespaceMap(parsed.context);
    const nodeDeclarations = processNodes(parsed);
    const { directTriples, reifiedStatements } = processEdges(parsed);
    return {
        namespaces,
        nodeDeclarations,
        directTriples,
        reifiedStatements,
    };
}
/**
 * Process CX2 nodes to node declarations
 */
function processNodes(parsed) {
    const declarations = [];
    for (const node of parsed.nodes) {
        declarations.push({
            uri: node.v.r,
            label: node.v.n,
            type: nodeTypeToSioUri(node.v.type),
            aliases: node.v.alias,
        });
    }
    return declarations;
}
/**
 * Process CX2 edges to RDF triples and reified statements
 */
function processEdges(parsed) {
    const directTriples = [];
    const reifiedStatements = [];
    for (const edge of parsed.edges) {
        const sourceUri = parsed.nodeIdToUri.get(edge.s);
        const targetUri = parsed.nodeIdToUri.get(edge.t);
        if (!sourceUri || !targetUri) {
            console.warn(`Skipping edge ${edge.id}: missing node URIs`);
            continue;
        }
        // Parse relationships from HTML
        const relationships = parseRelationships(edge.v.Relationships);
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
            });
        }
    }
    return { directTriples, reifiedStatements };
}
/**
 * Find node URI by gene/protein name
 */
function findNodeUriByName(parsed, name) {
    for (const node of parsed.nodes) {
        if (node.v.n === name) {
            return node.v.r;
        }
    }
    return undefined;
}
// Re-export submodule functions for convenience
export { parseRelationships, getTotalEvidenceCount } from './relationship-parser.js';
export { getRdfMapping, getPredicateUri, getProcessTypeUri } from './indra-type-mapper.js';
//# sourceMappingURL=index.js.map