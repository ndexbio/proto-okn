/**
 * NCI-PID Relationship Parser
 * Two-tier parsing: Primary URL params, Fallback text parsing
 */
import type { ParsedRelationship } from '../../core/types.js';
/**
 * Parse INDRA URL to extract subject, object, and type
 */
export declare function parseIndraUrl(url: string): {
    subject?: string;
    object?: string;
    type?: string;
} | null;
/**
 * Parse all relationships from Relationships HTML field
 */
export declare function parseRelationships(relationshipsHtml: string): ParsedRelationship[];
/**
 * Get total evidence count from Relationships HTML
 */
export declare function getTotalEvidenceCount(relationshipsHtml: string): number;
/**
 * Extract all INDRA URLs from Relationships HTML
 */
export declare function extractIndraUrls(relationshipsHtml: string): string[];
//# sourceMappingURL=relationship-parser.d.ts.map