import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nodeTypeToClassUri,
  inferClassFromIdentifier,
  isBareName,
  buildEntityUri,
  buildFamilyUri,
  buildPathwayUri,
  buildStatementUri,
  buildUri,
  buildRoUri,
  buildGoUri,
  buildSioUri,
  slugify,
  toSafeIri,
  isValidPrefixedUri,
  BIOLINK_PATHWAY,
  BIOLINK_GENE_FAMILY,
} from '../dist/core/uri-builder.js';

const OBO = 'http://purl.obolibrary.org/obo/';
const SIO = 'http://semanticscience.org/resource/SIO_';

// --- type mapping -----------------------------------------------------------

test('nodeTypeToClassUri: protein', () => {
  assert.equal(nodeTypeToClassUri('protein'), `${SIO}010043`);
});

test('nodeTypeToClassUri: smallmolecule is a molecular entity, NOT a protein', () => {
  // The published-graph defect: cholesterol, cAMP and 11-cis-retinal were all
  // typed SIO:010043, so "select all proteins" returned chemicals.
  const cls = nodeTypeToClassUri('smallmolecule');
  assert.equal(cls, `${OBO}CHEBI_23367`);
  assert.notEqual(cls, `${SIO}010043`);
});

test('nodeTypeToClassUri: legacy CamelCase RnaReference resolves via lowercasing', () => {
  assert.equal(nodeTypeToClassUri('RnaReference'), `${OBO}SO_0000655`);
});

test('nodeTypeToClassUri: lookup is case-insensitive', () => {
  assert.equal(nodeTypeToClassUri('SmallMolecule'), nodeTypeToClassUri('smallmolecule'));
  assert.equal(nodeTypeToClassUri('PROTEIN'), `${SIO}010043`);
});

test('nodeTypeToClassUri: returns undefined for an unknown type — no default', () => {
  // Removing the `?? typeMap.protein` fallback is the core of the fix; a default
  // is what made every unmapped type silently become a protein.
  assert.equal(nodeTypeToClassUri('widget'), undefined);
  assert.equal(nodeTypeToClassUri(undefined), undefined);
  assert.equal(nodeTypeToClassUri(''), undefined);
});

test('nodeTypeToClassUri: uses corrected term IDs, not the ones that resolve elsewhere', () => {
  // Each left-hand value below was in the design table and resolves to an
  // unrelated concept: SIO_010046 = biological entity, SIO_010298 = medical data,
  // SIO_000552 = the *property* "has parameter", NCIT_C53415 = a lesion type.
  assert.equal(nodeTypeToClassUri('complex'), `${SIO}010497`);
  assert.equal(nodeTypeToClassUri('antibody'), `${SIO}010465`);
  assert.equal(nodeTypeToClassUri('signal'), `${SIO}010438`);
  assert.equal(nodeTypeToClassUri('stimulus'), `${OBO}NCIT_C41210`);
  for (const wrong of [`${SIO}010046`, `${SIO}010298`, `${SIO}000552`, `${OBO}NCIT_C53415`, `${SIO}010430`]) {
    assert.equal(
      ['complex', 'antibody', 'signal', 'stimulus', 'geneproduct'].some((t) => nodeTypeToClassUri(t) === wrong),
      false,
      `${wrong} must not be emitted`
    );
  }
});

test('nodeTypeToClassUri: every mapped class is an absolute IRI', () => {
  const types = ['protein', 'proteinfamily', 'complex', 'antibody', 'signal', 'gene', 'variant',
    'mrna', 'mirna', 'lncrna', 'rnareference', 'rna', 'smallmolecule', 'chemical', 'drug',
    'disease', 'phenotype', 'cellularcomponent', 'biologicalprocess', 'molecularfunction',
    'tissue', 'stimulus'];
  for (const t of types) {
    const cls = nodeTypeToClassUri(t);
    assert.ok(cls, `${t} should map`);
    assert.match(cls, /^https?:\/\//, `${t} -> ${cls} must be absolute`);
  }
});

// --- identifier-space inference ---------------------------------------------

test('inferClassFromIdentifier: uniprot entails protein, chebi entails molecular entity', () => {
  assert.equal(inferClassFromIdentifier('uniprot:P01234'), `${SIO}010043`);
  assert.equal(inferClassFromIdentifier('CHEBI:16618'), `${OBO}CHEBI_23367`);
});

test('inferClassFromIdentifier: yields nothing for spaces with mixed membership', () => {
  // hgnc.symbol and bare names say nothing about kind, so nothing is inferred.
  assert.equal(inferClassFromIdentifier('hgnc.symbol:TP53'), undefined);
  assert.equal(inferClassFromIdentifier('ACTR2'), undefined);
  assert.equal(inferClassFromIdentifier(undefined), undefined);
});

// --- bare names and minted IRIs ---------------------------------------------

test('isBareName: true only when there is no colon', () => {
  assert.equal(isBareName('ACTR2'), true);
  assert.equal(isBareName('MIR34A'), true);
  assert.equal(isBareName('uniprot:P01234'), false);
  // A CURIE whose prefix is undeclared is a namespace gap, not a bare name —
  // treating it as one minted entity/uniprot-P42229 for real proteins.
  assert.equal(isBareName('undeclared:X'), false);
});

test('buildEntityUri: mints an absolute IRI under the graph base', () => {
  assert.equal(
    buildEntityUri('https://www.ndexbio.org/identifiers/', 'ACTR2'),
    'https://www.ndexbio.org/identifiers/entity/ACTR2'
  );
});

test('buildFamilyUri: identity comes from the member set, not the display name', () => {
  const base = 'https://www.ndexbio.org/identifiers/';
  const a = buildFamilyUri(base, 'RAS family', ['hgnc.symbol:HRAS', 'hgnc.symbol:KRAS']);
  const b = buildFamilyUri(base, 'RAS family', ['hgnc.symbol:KRAS', 'hgnc.symbol:HRAS']); // reordered
  const c = buildFamilyUri(base, 'RAS family', ['hgnc.symbol:HRAS', 'hgnc.symbol:NRAS']); // different members
  assert.equal(a, b, 'member order must not change identity');
  assert.notEqual(a, c, 'different membership must not converge');
});

test('buildFamilyUri: falls back to a name-only IRI with no members', () => {
  assert.equal(buildFamilyUri('base/', 'RAS family', []), 'base/family/RAS-family');
});

test('buildPathwayUri: prefers a UUID over the name slug', () => {
  assert.equal(buildPathwayUri('base/', 'Some Pathway', 'uuid-1'), 'base/pathway/uuid-1');
  assert.equal(buildPathwayUri('base/', 'Some Pathway'), 'base/pathway/Some-Pathway');
});

test('buildStatementUri: stable per edge and relationship index', () => {
  assert.equal(buildStatementUri('base/', 12, 3), 'base/statement_12_3');
});

// --- misc helpers -----------------------------------------------------------

test('slugify: collapses non-alphanumerics and trims separators', () => {
  assert.equal(slugify('  IL5-mediated signaling events '), 'IL5-mediated-signaling-events');
  assert.equal(slugify("3',5'-cyclic AMP"), '3-5-cyclic-AMP');
});

test('toSafeIri: percent-encodes IRI-illegal characters but leaves URL syntax alone', () => {
  assert.equal(toSafeIri('https://x.test/a b'), 'https://x.test/a%20b');
  assert.equal(toSafeIri('https://x.test/?a=1&b=2'), 'https://x.test/?a=1&b=2');
  assert.equal(toSafeIri('https://x.test/<>"'), 'https://x.test/%3C%3E%22');
});

test('buildUri: expands via the namespace map, case-insensitively', () => {
  const ns = { chebi: 'http://purl.obolibrary.org/obo/CHEBI_' };
  assert.equal(buildUri('CHEBI:16618', ns), 'http://purl.obolibrary.org/obo/CHEBI_16618');
  assert.equal(buildUri('http://already/absolute', ns), 'http://already/absolute');
  assert.equal(buildUri('ACTR2', ns), 'ACTR2');
});

test('isValidPrefixedUri: honours case-insensitive prefixes', () => {
  const ns = { chebi: 'x' };
  assert.equal(isValidPrefixedUri('CHEBI:1', ns), true);
  assert.equal(isValidPrefixedUri('ACTR2', ns), false);
});

test('ontology URI builders accept both prefixed and bare ids', () => {
  assert.equal(buildRoUri('RO:0002436'), `${OBO}RO_0002436`);
  assert.equal(buildRoUri('0002436'), `${OBO}RO_0002436`);
  assert.equal(buildGoUri('GO:0006468'), `${OBO}GO_0006468`);
  assert.equal(buildSioUri('SIO:010043'), `${SIO}010043`);
});

test('Biolink constants', () => {
  assert.equal(BIOLINK_PATHWAY, 'https://w3id.org/biolink/vocab/Pathway');
  assert.equal(BIOLINK_GENE_FAMILY, 'https://w3id.org/biolink/vocab/GeneFamily');
});
