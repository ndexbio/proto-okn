/**
 * INDRA Type Mapper
 * Maps INDRA statement types to RO predicates and GO process types
 */

import type { RdfMapping } from '../../core/types.js';

/**
 * RO Predicate URIs
 */
export const RO_PREDICATES = {
  MOLECULARLY_INTERACTS_WITH: 'http://purl.obolibrary.org/obo/RO_0002436',
  POSITIVELY_REGULATES: 'http://purl.obolibrary.org/obo/RO_0002629',
  NEGATIVELY_REGULATES: 'http://purl.obolibrary.org/obo/RO_0002630',
  DIRECTLY_REGULATES_ACTIVITY: 'http://purl.obolibrary.org/obo/RO_0002578',
  REGULATES: 'http://purl.obolibrary.org/obo/RO_0002211',
  CAUSALLY_RELATED_TO: 'http://purl.obolibrary.org/obo/RO_0002410',
} as const;

/**
 * GO Process Type URIs
 */
export const GO_PROCESSES = {
  PHOSPHORYLATION: 'http://purl.obolibrary.org/obo/GO_0006468',
  DEPHOSPHORYLATION: 'http://purl.obolibrary.org/obo/GO_0006470',
  SUMOYLATION: 'http://purl.obolibrary.org/obo/GO_0016925',
  DESUMOYLATION: 'http://purl.obolibrary.org/obo/GO_0016926',
  UBIQUITINATION: 'http://purl.obolibrary.org/obo/GO_0016567',
  DEUBIQUITINATION: 'http://purl.obolibrary.org/obo/GO_0016579',
  ACETYLATION: 'http://purl.obolibrary.org/obo/GO_0006473',
  DEACETYLATION: 'http://purl.obolibrary.org/obo/GO_0016575',
  METHYLATION: 'http://purl.obolibrary.org/obo/GO_0006479',
  DEMETHYLATION: 'http://purl.obolibrary.org/obo/GO_0006482',
  PROTEIN_TRANSPORT: 'http://purl.obolibrary.org/obo/GO_0015031',
} as const;

/**
 * INDRA type to RDF mapping table
 */
const INDRA_TYPE_MAPPINGS: Record<string, RdfMapping> = {
  // Binding/Complex
  Complex: {
    predicate: RO_PREDICATES.MOLECULARLY_INTERACTS_WITH,
  },

  // Activation/Inhibition
  Activation: {
    predicate: RO_PREDICATES.POSITIVELY_REGULATES,
  },
  Inhibition: {
    predicate: RO_PREDICATES.NEGATIVELY_REGULATES,
  },

  // Phosphorylation
  Phosphorylation: {
    predicate: RO_PREDICATES.DIRECTLY_REGULATES_ACTIVITY,
    processType: GO_PROCESSES.PHOSPHORYLATION,
  },
  Dephosphorylation: {
    predicate: RO_PREDICATES.DIRECTLY_REGULATES_ACTIVITY,
    processType: GO_PROCESSES.DEPHOSPHORYLATION,
  },

  // Sumoylation
  Sumoylation: {
    predicate: RO_PREDICATES.DIRECTLY_REGULATES_ACTIVITY,
    processType: GO_PROCESSES.SUMOYLATION,
  },
  Desumoylation: {
    predicate: RO_PREDICATES.DIRECTLY_REGULATES_ACTIVITY,
    processType: GO_PROCESSES.DESUMOYLATION,
  },

  // Ubiquitination
  Ubiquitination: {
    predicate: RO_PREDICATES.DIRECTLY_REGULATES_ACTIVITY,
    processType: GO_PROCESSES.UBIQUITINATION,
  },
  Deubiquitination: {
    predicate: RO_PREDICATES.DIRECTLY_REGULATES_ACTIVITY,
    processType: GO_PROCESSES.DEUBIQUITINATION,
  },

  // Acetylation
  Acetylation: {
    predicate: RO_PREDICATES.DIRECTLY_REGULATES_ACTIVITY,
    processType: GO_PROCESSES.ACETYLATION,
  },
  Deacetylation: {
    predicate: RO_PREDICATES.DIRECTLY_REGULATES_ACTIVITY,
    processType: GO_PROCESSES.DEACETYLATION,
  },

  // Methylation
  Methylation: {
    predicate: RO_PREDICATES.DIRECTLY_REGULATES_ACTIVITY,
    processType: GO_PROCESSES.METHYLATION,
  },
  Demethylation: {
    predicate: RO_PREDICATES.DIRECTLY_REGULATES_ACTIVITY,
    processType: GO_PROCESSES.DEMETHYLATION,
  },

  // Amount changes
  IncreaseAmount: {
    predicate: RO_PREDICATES.POSITIVELY_REGULATES,
  },
  DecreaseAmount: {
    predicate: RO_PREDICATES.NEGATIVELY_REGULATES,
  },

  // Translocation
  Translocation: {
    predicate: RO_PREDICATES.CAUSALLY_RELATED_TO,
    processType: GO_PROCESSES.PROTEIN_TRANSPORT,
  },
};

/**
 * Default mapping for unknown types
 */
const DEFAULT_MAPPING: RdfMapping = {
  predicate: RO_PREDICATES.REGULATES,
};

/**
 * Get RDF mapping for an INDRA type
 */
export function getRdfMapping(indraType: string): RdfMapping {
  return INDRA_TYPE_MAPPINGS[indraType] ?? DEFAULT_MAPPING;
}

/**
 * Check if INDRA type has a known mapping
 */
export function hasMapping(indraType: string): boolean {
  return indraType in INDRA_TYPE_MAPPINGS;
}

/**
 * Get all known INDRA types
 */
export function getKnownIndraTypes(): string[] {
  return Object.keys(INDRA_TYPE_MAPPINGS);
}

/**
 * Get predicate URI for INDRA type
 */
export function getPredicateUri(indraType: string): string {
  const mapping = getRdfMapping(indraType);
  return mapping.predicate;
}

/**
 * Get process type URI for INDRA type (if applicable)
 */
export function getProcessTypeUri(indraType: string): string | undefined {
  const mapping = getRdfMapping(indraType);
  return mapping.processType;
}
