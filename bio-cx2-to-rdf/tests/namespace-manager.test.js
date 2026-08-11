import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePrefix,
  expandUri,
  hasPrefix,
  compactUri,
  canonicalizeContext,
  createNamespaceMap,
  STANDARD_PREFIXES,
  NDEX_IDENTIFIERS_BASE,
  NDEX_VOCAB_BASE,
} from '../dist/core/namespace-manager.js';

const NS = { chebi: 'http://purl.obolibrary.org/obo/CHEBI_', uniprot: 'http://purl.uniprot.org/uniprot/' };

test('resolvePrefix: exact match', () => {
  assert.equal(resolvePrefix('chebi', NS), 'http://purl.obolibrary.org/obo/CHEBI_');
});

test('resolvePrefix: case-insensitive fallback (CHEBI: against declared chebi:)', () => {
  // The defect this guards: NCI-PID declares `chebi` but writes `CHEBI:16618`
  // on every node, so an exact-only lookup emitted relative IRIs.
  assert.equal(resolvePrefix('CHEBI', NS), 'http://purl.obolibrary.org/obo/CHEBI_');
});

test('resolvePrefix: exact match wins over a case-insensitive candidate', () => {
  const both = { chebi: 'http://lower/', CHEBI: 'http://upper/' };
  assert.equal(resolvePrefix('CHEBI', both), 'http://upper/');
  assert.equal(resolvePrefix('chebi', both), 'http://lower/');
});

test('resolvePrefix: unknown prefix yields undefined', () => {
  assert.equal(resolvePrefix('nosuch', NS), undefined);
});

test('expandUri: expands a CURIE whose prefix case differs from the declaration', () => {
  assert.equal(expandUri('CHEBI:16618', NS), 'http://purl.obolibrary.org/obo/CHEBI_16618');
});

test('expandUri: leaves an unknown prefix untouched', () => {
  assert.equal(expandUri('nosuch:1', NS), 'nosuch:1');
});

test('expandUri: leaves a colon-free bare name untouched', () => {
  assert.equal(expandUri('ACTR2', NS), 'ACTR2');
});

test('expandUri: splits on the FIRST colon so URL-ish locals survive', () => {
  const ns = { ndex: 'https://www.ndexbio.org/v3/networks/' };
  assert.equal(expandUri('ndex:abc:def', ns), 'https://www.ndexbio.org/v3/networks/abc:def');
});

test('hasPrefix: true for a known prefix in either case, false for a bare name', () => {
  assert.equal(hasPrefix('CHEBI:1', NS), true);
  assert.equal(hasPrefix('chebi:1', NS), true);
  assert.equal(hasPrefix('ACTR2', NS), false);
});

test('compactUri: round-trips an expanded IRI', () => {
  assert.equal(compactUri('http://purl.obolibrary.org/obo/CHEBI_16618', NS), 'chebi:16618');
});

test('canonicalizeContext: rewrites prefixes Bioregistry canonicalizes', () => {
  const out = canonicalizeContext({
    uniprot: 'https://identifiers.org/uniprot/',
    chebi: 'https://identifiers.org/chebi/CHEBI:',
  });
  assert.equal(out.uniprot, 'http://purl.uniprot.org/uniprot/');
  assert.equal(out.chebi, 'http://purl.obolibrary.org/obo/CHEBI_');
});

test('canonicalizeContext: keeps @context values for prefixes with no rdf_uri_format', () => {
  // `cas` resolves only to a provider webpage, so the network's own value stands.
  const out = canonicalizeContext({ cas: 'https://identifiers.org/cas/' });
  assert.equal(out.cas, 'https://identifiers.org/cas/');
});

test('createNamespaceMap: standard prefixes win over a conflicting @context', () => {
  const out = createNamespaceMap({ rdf: 'http://evil.example/' });
  assert.equal(out.rdf, STANDARD_PREFIXES.rdf);
});

test('createNamespaceMap: seeds uniprot/chebi when the network ships no @context', () => {
  // The IL3/4/5 NCI-PID exports carry no @context at all; without this floor
  // their `uniprot:` CURIEs resolve to nothing and serialize as relative IRIs.
  const out = createNamespaceMap({});
  assert.equal(out.uniprot, 'http://purl.uniprot.org/uniprot/');
  assert.equal(out.chebi, 'http://purl.obolibrary.org/obo/CHEBI_');
});

test('createNamespaceMap: retires the example.org placeholder', () => {
  const out = createNamespaceMap({});
  const stems = Object.values(out).join(' ');
  assert.equal(stems.includes('example.org'), false);
  assert.equal(out.ncipid, NDEX_IDENTIFIERS_BASE);
  assert.equal(out.ncipidv, NDEX_VOCAB_BASE);
});

test('NDEx bases follow the NeST/IAS entity-vs-vocabulary split', () => {
  assert.equal(NDEX_IDENTIFIERS_BASE, 'https://www.ndexbio.org/identifiers/');
  assert.equal(NDEX_VOCAB_BASE, 'https://www.ndexbio.org/vocab/ncipid/');
});
