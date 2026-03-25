/**
 * NCI-PID Relationship Parser
 * Two-tier parsing: Primary URL params, Fallback text parsing
 */
/**
 * Known predicate patterns for text-based fallback parsing
 */
const PREDICATE_PATTERNS = {
    'binds': 'Complex',
    'activates': 'Activation',
    'inhibits': 'Inhibition',
    'phosphorylates': 'Phosphorylation',
    'dephosphorylates': 'Dephosphorylation',
    'sumoylates': 'Sumoylation',
    'desumoylates': 'Desumoylation',
    'ubiquitinates': 'Ubiquitination',
    'deubiquitinates': 'Deubiquitination',
    'acetylates': 'Acetylation',
    'deacetylates': 'Deacetylation',
    'methylates': 'Methylation',
    'demethylates': 'Demethylation',
    'increases the amount of': 'IncreaseAmount',
    'decreases the amount of': 'DecreaseAmount',
    'translocates': 'Translocation',
};
/**
 * Parse INDRA URL to extract subject, object, and type
 */
export function parseIndraUrl(url) {
    try {
        const urlObj = new URL(url);
        const params = urlObj.searchParams;
        return {
            subject: params.get('subject') ?? undefined,
            object: params.get('object') ?? undefined,
            type: params.get('type') ?? undefined,
        };
    }
    catch {
        return null;
    }
}
/**
 * Extract evidence count from HTML anchor text
 * Looks for patterns like ">32</a>" or ">(32)"
 */
function extractEvidenceCount(html) {
    // Match patterns like ">32</a>" or ">32<"
    const match = html.match(/>(\d+)<\/a>/);
    if (match) {
        return parseInt(match[1], 10);
    }
    return 0;
}
/**
 * Parse relationship text to extract subject, predicate, object
 * Handles patterns like "PIAS1 sumoylates HDAC1"
 */
function parseRelationshipText(text) {
    // Clean up text
    const cleanText = text.trim();
    // Try each predicate pattern
    for (const [predicate, indraType] of Object.entries(PREDICATE_PATTERNS)) {
        const pattern = new RegExp(`^(\\w+)\\s+${predicate}\\s+(\\w+)$`, 'i');
        const match = cleanText.match(pattern);
        if (match) {
            return {
                subject: match[1],
                predicate,
                object: match[2],
                indraType,
            };
        }
    }
    return null;
}
/**
 * Parse all relationships from Relationships HTML field
 */
export function parseRelationships(relationshipsHtml) {
    const relationships = [];
    // Extract individual relationship items
    // Pattern: <li/>TEXT(<a href="URL">COUNT</a>)
    const itemPattern = /<li\/>([^<]+)\(<a\s+href="([^"]+)"[^>]*>(\d+)<\/a>\)/g;
    let match;
    while ((match = itemPattern.exec(relationshipsHtml)) !== null) {
        const text = match[1].trim();
        const url = match[2];
        const count = parseInt(match[3], 10);
        // Primary: Try URL-based parsing
        const urlParams = parseIndraUrl(url);
        if (urlParams?.subject && urlParams?.object && urlParams?.type) {
            relationships.push({
                subject: urlParams.subject,
                predicate: inferPredicate(urlParams.type),
                object: urlParams.object,
                evidenceCount: count,
                evidenceUrl: url,
                indraType: urlParams.type,
            });
            continue;
        }
        // Fallback: Text-based parsing
        const textParsed = parseRelationshipText(text);
        if (textParsed?.subject && textParsed?.object) {
            relationships.push({
                subject: textParsed.subject,
                predicate: textParsed.predicate ?? 'interacts with',
                object: textParsed.object,
                evidenceCount: count,
                evidenceUrl: url,
                indraType: textParsed.indraType ?? 'Unknown',
            });
        }
    }
    return relationships;
}
/**
 * Infer predicate verb from INDRA type
 */
function inferPredicate(indraType) {
    const typeToVerb = {
        Complex: 'binds',
        Activation: 'activates',
        Inhibition: 'inhibits',
        Phosphorylation: 'phosphorylates',
        Dephosphorylation: 'dephosphorylates',
        Sumoylation: 'sumoylates',
        Desumoylation: 'desumoylates',
        Ubiquitination: 'ubiquitinates',
        Deubiquitination: 'deubiquitinates',
        Acetylation: 'acetylates',
        Deacetylation: 'deacetylates',
        Methylation: 'methylates',
        Demethylation: 'demethylates',
        IncreaseAmount: 'increases the amount of',
        DecreaseAmount: 'decreases the amount of',
        Translocation: 'translocates',
    };
    return typeToVerb[indraType] ?? 'interacts with';
}
/**
 * Get total evidence count from Relationships HTML
 */
export function getTotalEvidenceCount(relationshipsHtml) {
    // Look for "All Evidences" pattern
    const allEvidencesPattern = /All Evidences \(<a[^>]+>(\d+)<\/a>\)/;
    const match = relationshipsHtml.match(allEvidencesPattern);
    if (match) {
        return parseInt(match[1], 10);
    }
    return 0;
}
/**
 * Extract all INDRA URLs from Relationships HTML
 */
export function extractIndraUrls(relationshipsHtml) {
    const urls = [];
    const urlPattern = /href="(https:\/\/db\.indra\.bio\/[^"]+)"/g;
    let match;
    while ((match = urlPattern.exec(relationshipsHtml)) !== null) {
        urls.push(match[1]);
    }
    return urls;
}
//# sourceMappingURL=relationship-parser.js.map