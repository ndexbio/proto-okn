/**
 * INDRA Type Mapper
 * Maps INDRA statement types to RO predicates and GO process types
 */
import type { RdfMapping } from '../../core/types.js';
/**
 * RO Predicate URIs
 */
export declare const RO_PREDICATES: {
    readonly MOLECULARLY_INTERACTS_WITH: "http://purl.obolibrary.org/obo/RO_0002436";
    readonly POSITIVELY_REGULATES: "http://purl.obolibrary.org/obo/RO_0002629";
    readonly NEGATIVELY_REGULATES: "http://purl.obolibrary.org/obo/RO_0002630";
    readonly DIRECTLY_REGULATES_ACTIVITY: "http://purl.obolibrary.org/obo/RO_0002578";
    readonly REGULATES: "http://purl.obolibrary.org/obo/RO_0002211";
    readonly CAUSALLY_RELATED_TO: "http://purl.obolibrary.org/obo/RO_0002410";
};
/**
 * GO Process Type URIs
 */
export declare const GO_PROCESSES: {
    readonly PHOSPHORYLATION: "http://purl.obolibrary.org/obo/GO_0006468";
    readonly DEPHOSPHORYLATION: "http://purl.obolibrary.org/obo/GO_0006470";
    readonly SUMOYLATION: "http://purl.obolibrary.org/obo/GO_0016925";
    readonly DESUMOYLATION: "http://purl.obolibrary.org/obo/GO_0016926";
    readonly UBIQUITINATION: "http://purl.obolibrary.org/obo/GO_0016567";
    readonly DEUBIQUITINATION: "http://purl.obolibrary.org/obo/GO_0016579";
    readonly ACETYLATION: "http://purl.obolibrary.org/obo/GO_0006473";
    readonly DEACETYLATION: "http://purl.obolibrary.org/obo/GO_0016575";
    readonly METHYLATION: "http://purl.obolibrary.org/obo/GO_0006479";
    readonly DEMETHYLATION: "http://purl.obolibrary.org/obo/GO_0006482";
    readonly PROTEIN_TRANSPORT: "http://purl.obolibrary.org/obo/GO_0015031";
};
/**
 * Get RDF mapping for an INDRA type
 */
export declare function getRdfMapping(indraType: string): RdfMapping;
/**
 * Check if INDRA type has a known mapping
 */
export declare function hasMapping(indraType: string): boolean;
/**
 * Get all known INDRA types
 */
export declare function getKnownIndraTypes(): string[];
/**
 * Get predicate URI for INDRA type
 */
export declare function getPredicateUri(indraType: string): string;
/**
 * Get process type URI for INDRA type (if applicable)
 */
export declare function getProcessTypeUri(indraType: string): string | undefined;
//# sourceMappingURL=indra-type-mapper.d.ts.map