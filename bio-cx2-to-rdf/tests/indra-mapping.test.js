import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getRdfMapping,
  getPredicateUri,
  getProcessTypeUri,
  hasMapping,
  getKnownIndraTypes,
  RO_PREDICATES,
  GO_PROCESSES,
} from '../dist/adapters/nci-pid/indra-type-mapper.js';
import {
  parseRelationships,
  parseIndraUrl,
  getTotalEvidenceCount,
  extractIndraUrls,
} from '../dist/adapters/nci-pid/relationship-parser.js';
import { indraItem } from './helpers/cx2.js';

// --- INDRA type -> RDF ------------------------------------------------------

test('getRdfMapping: Complex is a symmetric molecular interaction with no process type', () => {
  const m = getRdfMapping('Complex');
  assert.equal(m.predicate, RO_PREDICATES.MOLECULARLY_INTERACTS_WITH);
  assert.equal(m.processType, undefined);
});

test('getRdfMapping: PTMs carry both a predicate and a GO process type', () => {
  const m = getRdfMapping('Phosphorylation');
  assert.equal(m.predicate, RO_PREDICATES.DIRECTLY_REGULATES_ACTIVITY);
  assert.equal(m.processType, GO_PROCESSES.PHOSPHORYLATION);
});

test('getRdfMapping: Activation and Inhibition map to opposite regulation predicates', () => {
  assert.equal(getRdfMapping('Activation').predicate, RO_PREDICATES.POSITIVELY_REGULATES);
  assert.equal(getRdfMapping('Inhibition').predicate, RO_PREDICATES.NEGATIVELY_REGULATES);
});

test('getRdfMapping: unknown types fall back to the generic regulates predicate', () => {
  const m = getRdfMapping('NoSuchIndraType');
  assert.equal(m.predicate, RO_PREDICATES.REGULATES);
  assert.equal(hasMapping('NoSuchIndraType'), false);
});

test('every known INDRA type maps to an absolute OBO predicate IRI', () => {
  for (const t of getKnownIndraTypes()) {
    assert.match(getPredicateUri(t), /^http:\/\/purl\.obolibrary\.org\/obo\/RO_\d+$/, t);
    const pt = getProcessTypeUri(t);
    if (pt) assert.match(pt, /^http:\/\/purl\.obolibrary\.org\/obo\/GO_\d+$/, t);
  }
});

// --- relationship parsing ---------------------------------------------------

test('parseIndraUrl: extracts subject, object and type from query params', () => {
  const p = parseIndraUrl('https://db.indra.bio/statements/from_agents?subject=SRC&object=JUN&type=Activation');
  assert.deepEqual(p, { subject: 'SRC', object: 'JUN', type: 'Activation' });
});

test('parseIndraUrl: returns null for a non-URL', () => {
  assert.equal(parseIndraUrl('not a url'), null);
});

test('parseRelationships: reads subject/object/type/count from the anchor URL', () => {
  const rels = parseRelationships(indraItem({ subject: 'SRC', object: 'JUN', type: 'Activation', count: 32 }));
  assert.equal(rels.length, 1);
  assert.equal(rels[0].subject, 'SRC');
  assert.equal(rels[0].object, 'JUN');
  assert.equal(rels[0].indraType, 'Activation');
  assert.equal(rels[0].evidenceCount, 32);
  assert.equal(rels[0].predicate, 'activates');
});

test('parseRelationships: handles several items in one field', () => {
  const html =
    indraItem({ subject: 'A', object: 'B', type: 'Complex', count: 1 }) +
    indraItem({ subject: 'B', object: 'C', type: 'Phosphorylation', count: 9 });
  const rels = parseRelationships(html);
  assert.equal(rels.length, 2);
  assert.deepEqual(rels.map((r) => r.indraType), ['Complex', 'Phosphorylation']);
});

test('parseRelationships: an empty or absent field yields no relationships', () => {
  assert.deepEqual(parseRelationships(''), []);
  assert.deepEqual(parseRelationships('<p>no items here</p>'), []);
});

test('getTotalEvidenceCount / extractIndraUrls', () => {
  const html =
    'All Evidences (<a href="https://db.indra.bio/statements/x" target="_blank">57</a>)' +
    indraItem({ subject: 'A', object: 'B', type: 'Complex' });
  assert.equal(getTotalEvidenceCount(html), 57);
  assert.equal(extractIndraUrls(html).length, 2);
  assert.equal(getTotalEvidenceCount('<p>none</p>'), 0);
});
