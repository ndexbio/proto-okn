/**
 * NCI-PID Adapter Entry Point
 * Converts NCI-PID CX2 networks to RDF structures
 */
import type { ParsedCX2, RdfOutput } from '../../core/types.js';
/**
 * Convert parsed CX2 to RDF output structure
 */
export declare function convertToRdf(parsed: ParsedCX2): RdfOutput;
export { parseRelationships, getTotalEvidenceCount } from './relationship-parser.js';
export { getRdfMapping, getPredicateUri, getProcessTypeUri } from './indra-type-mapper.js';
//# sourceMappingURL=index.d.ts.map