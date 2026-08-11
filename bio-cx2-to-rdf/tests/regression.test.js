/**
 * End-to-end regression tests, one per defect found in the published NCI-PID
 * graph (see ../../remaining_issues.md). Each asserts on serialized Turtle, so
 * it fails if any layer — mapping, prefix resolution, or serialization —
 * reintroduces the defect.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCX2 } from '../dist/core/cx2-parser.js';
import { convertToRdf } from '../dist/adapters/nci-pid/index.js';
import { writeToTurtle } from '../dist/core/turtle-writer.js';
import { cx2Json, NCI_PID_CONTEXT, NCI_PID_NODE_DECLS, indraItem } from './helpers/cx2.js';

/** Convert a fixture all the way to Turtle. */
async function toTurtle(opts) {
  return writeToTurtle(convertToRdf(parseCX2(cx2Json(opts))));
}

/** Every IRI the document emits inside angle brackets, plus prefixed names. */
function relativeIris(ttl) {
  const body = ttl.replace(/^@prefix[^\n]*\n/gm, '');
  return [...body.matchAll(/<([^>]*)>/g)]
    .map((m) => m[1])
    .filter((iri) => !iri.includes('://'));
}

const MIXED_NETWORK = {
  nodeDecls: NCI_PID_NODE_DECLS,
  context: NCI_PID_CONTEXT,
  nodes: [
    { id: 0, v: { n: 'SRC', r: 'uniprot:P12931' } },
    { id: 1, v: { n: 'choline', r: 'CHEBI:15354', type: 'smallmolecule' } },
    { id: 2, v: { n: 'phosphatidic acid', r: 'CHEBI:16337', type: 'smallmolecule' } },
    { id: 3, v: { n: 'ETS', r: 'ETS' } },
    { id: 4, v: { n: 'MIR34A', r: 'MIR34A', type: 'RnaReference' } },
    { id: 5, v: { n: 'glutathione', r: 'cas:17-18-8', type: 'smallmolecule' } },
    { id: 6, v: { n: 'RAS family', r: 'RAS family', type: 'proteinfamily', member: ['hgnc.symbol:HRAS'] } },
  ],
  edges: [
    { id: 0, s: 0, t: 1, v: { Relationships: indraItem({ subject: 'SRC', object: 'choline', type: 'Activation', count: 5 }) } },
  ],
};

test('issue 6: "select all proteins" returns no chemicals', async () => {
  const ttl = await toTurtle(MIXED_NETWORK);
  const proteinSubjects = [...ttl.matchAll(/^(\S+) a SIO:010043/gm)].map((m) => m[1]);
  assert.ok(proteinSubjects.length > 0, 'the fixture does contain a protein');
  for (const s of proteinSubjects) {
    assert.equal(/chebi:|pubchem:|CHEBI_|compound\/CID/.test(s), false, `${s} is a chemical typed as protein`);
  }
});

test('issue 3: no relative, scheme-less IRIs anywhere in the document', async () => {
  const ttl = await toTurtle(MIXED_NETWORK);
  assert.deepEqual(relativeIris(ttl), [], 'every IRI must carry a scheme');
});

test('issue 2: bare names do not leak as unresolvable identifiers', async () => {
  const ttl = await toTurtle(MIXED_NETWORK);
  assert.equal(ttl.includes('file://'), false);
  // ETS and MIR34A are bare names in the source; both must be minted.
  assert.match(ttl, /identifiers\/entity\/ETS|ncipid:entity\/ETS/);
  assert.match(ttl, /identifiers\/entity\/MIR34A|ncipid:entity\/MIR34A/);
});

test('issue 7: the example.org placeholder appears nowhere', async () => {
  const ttl = await toTurtle(MIXED_NETWORK);
  assert.equal(ttl.includes('example.org'), false);
});

test('issue 9: ChEBI is canonicalized to the OBO stem despite a lowercase @context', async () => {
  const ttl = await toTurtle(MIXED_NETWORK);
  assert.match(ttl, /@prefix chebi: <http:\/\/purl\.obolibrary\.org\/obo\/CHEBI_>/);
  assert.equal(ttl.includes('identifiers.org/chebi'), false);
});

test('uniprot is canonicalized to purl.uniprot.org', async () => {
  const ttl = await toTurtle(MIXED_NETWORK);
  assert.match(ttl, /@prefix uniprot: <http:\/\/purl\.uniprot\.org\/uniprot\/>/);
});

test('a network with no @context still produces absolute IRIs', async () => {
  // The IL3/4/5 exports ship no @context at all.
  const ttl = await toTurtle({
    nodeDecls: NCI_PID_NODE_DECLS,
    nodes: [
      { id: 0, v: { n: 'BCL2L1', r: 'uniprot:E1P5L6' } },
      { id: 1, v: { n: 'STAT5A', r: 'uniprot:P42229' } },
    ],
  });
  assert.deepEqual(relativeIris(ttl), []);
  assert.match(ttl, /uniprot:E1P5L6 a SIO:010043/);
  assert.equal(ttl.includes('entity/uniprot-'), false, 'real UniProt ids must not be minted away');
});

test('RnaReference is typed ncRNA, not protein', async () => {
  const ttl = await toTurtle(MIXED_NETWORK);
  assert.match(ttl, /SO:0000655/);
});

test('a source CAS typo is corrected via the curated override', async () => {
  // The CX2 records glutathione as CAS 17-18-8, which is not a valid registry
  // number; the override normalizes through the real one (70-18-8).
  const ttl = await toTurtle(MIXED_NETWORK);
  assert.match(ttl, /chebi:16856|CHEBI_16856|compound\/CID124886|pubchem:124886/);
});

test('the whole document parses as valid Turtle', async () => {
  const { Parser } = await import('n3');
  const ttl = await toTurtle(MIXED_NETWORK);
  const quads = new Parser().parse(ttl);
  assert.ok(quads.length > 0);
  for (const q of quads) {
    if (q.subject.termType === 'NamedNode') assert.match(q.subject.value, /^https?:\/\//);
    if (q.object.termType === 'NamedNode') assert.match(q.object.value, /^https?:\/\//);
  }
});
