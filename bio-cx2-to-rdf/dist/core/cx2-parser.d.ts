/**
 * CX2 JSON parser
 * Parses CX2 format JSON array of aspects
 */
import type { ParsedCX2 } from './types.js';
/**
 * Parse CX2 JSON content
 * @param content - Raw JSON string of CX2 file
 * @returns Parsed CX2 structure
 */
export declare function parseCX2(content: string): ParsedCX2;
/**
 * Extract CX2 version from parsed content
 */
export declare function getCX2Version(content: string): string | null;
/**
 * Get node counts from parsed CX2
 */
export declare function getNodeCount(parsed: ParsedCX2): number;
/**
 * Get edge counts from parsed CX2
 */
export declare function getEdgeCount(parsed: ParsedCX2): number;
//# sourceMappingURL=cx2-parser.d.ts.map