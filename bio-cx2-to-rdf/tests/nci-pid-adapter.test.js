import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCX2 } from '../dist/core/cx2-parser.js';
import { convertToRdf } from '../dist/adapters/nci-pid/index.js';
import { cx2Json, NCI_PID_CONTEXT, NCI_PID_NODE_DECLS, indraItem, declByUri } from './helpers/cx2.js';

const SIO_PROTEIN = 'http://semanticscience.org/resource/SIO_010043';
const CHEBI_MOLECULAR_ENTITY = 'http://purl.obolibrary.org/obo/CHEBI_23367';
const RO_PARTICIPATES_IN = 'http://purl.obolibrary.org/obo/RO_0000056';
const RO_HAS_MEMBER = 'http://purl.obolibrary.org/obo/RO_0002351';
const BIOLINK_GENE_FAMILY = 'https://w3id.org/biolink/vocab/GeneFamily';
const BIOLINK_PATHWAY = 'https://w3id.org/biolink/vocab/Pathway';

const convert = (opts) => convertToRdf(parseCX2(cx2Json(opts)));

test('proteins keep SIO:010043 and their UniProt identity', () => {
  const rdf = convert({
    nodeDecls: NCI_PID_NODE_DECLS,
    context: NCI_PID_CONTEXT,
    nodes: [{ id: 0, v: { n: 'TP53', r: 'uniprot:P04637' } }],
  });
  assert.equal(rdf.nodeDeclarations[0].type, SIO_PROTEIN);
  assert.equal(rdf.nodeDeclarations[0].uri, 'uniprot:P04637');
});

test('a small molecule is NOT typed as a protein', () => {
  const rdf = convert({
    nodeDecls: NCI_PID_NODE_DECLS,
    context: NCI_PID_CONTEXT,
    nodes: [{ id: 0, v: { n: 'choline', r: 'CHEBI:15354', type: 'smallmolecule' } }],
  });
  const [decl] = rdf.nodeDeclarations;
  assert.equal(decl.type, CHEBI_MOLECULAR_ENTITY);
  assert.notEqual(decl.type, SIO_PROTEIN);
});

test('a known chemical is re-identified onto its PubChem CID', () => {
  const rdf = convert({
    nodeDecls: NCI_PID_NODE_DECLS,
    context: NCI_PID_CONTEXT,
    nodes: [{ id: 0, v: { n: 'choline', r: 'CHEBI:15354', type: 'smallmolecule' } }],
  });
  const [decl] = rdf.nodeDeclarations;
  assert.equal(decl.uri, 'http://rdf.ncbi.nlm.nih.gov/pubchem/compound/CID305');
  assert.ok(decl.exactMatch?.length, 'the source identifier must remain reachable');
  assert.ok(
    decl.exactMatch.some((m) => m.includes('CHEBI_15354')),
    'source ChEBI id should appear as skos:exactMatch'
  );
});

test('a chemical with no better identifier keeps its ChEBI IRI and gains no exactMatch', () => {
  // phosphatidic acid has no PubChem CID in its clique, so ChEBI is the answer
  // and there is no second identifier to record.
  const rdf = convert({
    nodeDecls: NCI_PID_NODE_DECLS,
    context: NCI_PID_CONTEXT,
    nodes: [{ id: 0, v: { n: 'phosphatidic acid', r: 'CHEBI:16337', type: 'smallmolecule' } }],
  });
  const [decl] = rdf.nodeDeclarations;
  assert.equal(decl.uri, 'http://purl.obolibrary.org/obo/CHEBI_16337');
  assert.equal(decl.exactMatch, undefined);
});

test('curated overrides keep the retinal isomers distinct and unlinked', () => {
  // 11-cis-retinal and all-trans-retinal both normalize to PubChem CID 638015.
  // Their isomerization is the phototransduction event, so the merge is rejected
  // — and neither may claim skos:exactMatch to the other.
  const rdf = convert({
    nodeDecls: NCI_PID_NODE_DECLS,
    context: NCI_PID_CONTEXT,
    nodes: [
      { id: 0, v: { n: '11-cis-retinal', r: 'CHEBI:16066', type: 'smallmolecule' } },
      { id: 1, v: { n: 'all-trans-retinal', r: 'CHEBI:17898', type: 'smallmolecule' } },
    ],
  });
  const [cis, trans] = rdf.nodeDeclarations;
  assert.notEqual(cis.uri, trans.uri, 'the isomers must remain separate entities');
  assert.equal(cis.uri, 'http://purl.obolibrary.org/obo/CHEBI_16066');
  assert.equal(trans.uri, 'http://purl.obolibrary.org/obo/CHEBI_17898');
  for (const d of [cis, trans]) {
    assert.equal(
      (d.exactMatch ?? []).some((m) => m.includes('CHEBI_16066') || m.includes('CHEBI_17898') || m.includes('CID638015')),
      false,
      'an overridden entity must not carry the rejected clique'
    );
  }
});

test('a bare-name node is minted an absolute IRI, never a relative one', () => {
  const rdf = convert({
    nodeDecls: NCI_PID_NODE_DECLS,
    context: NCI_PID_CONTEXT,
    nodes: [{ id: 0, v: { n: 'ETS', r: 'ETS' } }],
  });
  const [decl] = rdf.nodeDeclarations;
  assert.equal(decl.uri, 'https://www.ndexbio.org/identifiers/entity/ETS');
  assert.match(decl.uri, /^https?:\/\//);
  assert.equal(decl.label, 'ETS', 'the entity must stay findable by name');
});

test('an undeclared prefix is a namespace gap, not a bare name', () => {
  // Networks shipping no @context still identify proteins by uniprot: CURIEs;
  // minting entity/uniprot-P42229 for them would destroy a real identifier.
  const rdf = convert({
    nodeDecls: NCI_PID_NODE_DECLS,
    nodes: [{ id: 0, v: { n: 'STAT5A', r: 'uniprot:P42229' } }],
  });
  assert.equal(rdf.nodeDeclarations[0].uri, 'uniprot:P42229');
});

test('an untyped node infers its class from the identifier space', () => {
  const rdf = convert({
    nodeDecls: { represents: { d: 'string' }, name: { d: 'string' }, type: { d: 'string' } },
    nodes: [{ id: 0, v: { name: 'THY1', represents: 'uniprot:P04216' } }],
  });
  assert.equal(rdf.nodeDeclarations[0].type, SIO_PROTEIN);
});

test('an unknown type with an uninformative identifier is emitted untyped', () => {
  const rdf = convert({
    nodeDecls: { represents: { d: 'string' }, name: { d: 'string' }, type: { d: 'string' } },
    nodes: [{ id: 0, v: { name: 'Thing', represents: 'hgnc.symbol:XYZ', type: 'widget' } }],
  });
  assert.equal(rdf.nodeDeclarations[0].type, undefined, 'no class may be guessed');
});

test('family nodes type as biolink:GeneFamily and emit RO:0002351 member links', () => {
  const rdf = convert({
    nodeDecls: NCI_PID_NODE_DECLS,
    context: NCI_PID_CONTEXT,
    nodes: [{ id: 0, v: { n: 'RAS family', r: 'RAS family', type: 'proteinfamily', member: ['hgnc.symbol:HRAS', 'hgnc.symbol:KRAS'] } }],
  });
  const [decl] = rdf.nodeDeclarations;
  assert.equal(decl.type, BIOLINK_GENE_FAMILY);
  assert.match(decl.uri, /^https:\/\/www\.ndexbio\.org\/identifiers\/family\//);
  const members = rdf.directTriples.filter((t) => t.predicate === RO_HAS_MEMBER);
  assert.equal(members.length, 2);
  assert.deepEqual(members.map((m) => m.object).sort(), ['hgnc.symbol:HRAS', 'hgnc.symbol:KRAS']);
});

test('pathway membership edges are flipped to protein participates_in pathway', () => {
  const rdf = convert({
    nodeDecls: NCI_PID_NODE_DECLS,
    edgeDecls: { interaction: { a: 'i', d: 'string' } },
    context: NCI_PID_CONTEXT,
    nodes: [
      { id: 0, v: { n: 'A pathway', r: 'ndex:uuid-1', type: 'pathway' } },
      { id: 1, v: { n: 'TP53', r: 'uniprot:P04637' } },
    ],
    // CX2 stores the edge pathway -> protein; RDF wants protein -> pathway.
    edges: [{ id: 0, s: 0, t: 1, v: { i: 'participates in' } }],
  });
  const participates = rdf.directTriples.filter((t) => t.predicate === RO_PARTICIPATES_IN);
  assert.equal(participates.length, 1);
  assert.equal(participates[0].subject, 'uniprot:P04637');
  // Pathway nodes expand `represents` eagerly via buildUri, where ordinary nodes
  // stay CURIEs until the writer resolves them. Both reach the same IRI.
  assert.equal(participates[0].object, 'https://www.ndexbio.org/v3/networks/uuid-1');
  assert.ok(rdf.nodeDeclarations.some((d) => d.type === BIOLINK_PATHWAY));
});

test('an interaction produces both a direct triple and a reified statement', () => {
  const rdf = convert({
    nodeDecls: NCI_PID_NODE_DECLS,
    context: NCI_PID_CONTEXT,
    nodes: [
      { id: 0, v: { n: 'SRC', r: 'uniprot:P12931' } },
      { id: 1, v: { n: 'JUN', r: 'uniprot:P05412' } },
    ],
    edges: [{ id: 0, s: 0, t: 1, v: { Relationships: indraItem({ subject: 'SRC', object: 'JUN', type: 'Activation', count: 10 }) } }],
  });
  assert.equal(rdf.directTriples.length, 1);
  assert.equal(rdf.directTriples[0].predicate, 'http://purl.obolibrary.org/obo/RO_0002629');
  assert.equal(rdf.reifiedStatements.length, 1);
  assert.equal(rdf.reifiedStatements[0].evidenceCount, 10);
  assert.match(rdf.reifiedStatements[0].statementUri, /^https:\/\/www\.ndexbio\.org\/identifiers\/statement_0_0$/);
});

test('self-loops are dropped', () => {
  const rdf = convert({
    nodeDecls: NCI_PID_NODE_DECLS,
    context: NCI_PID_CONTEXT,
    nodes: [{ id: 0, v: { n: 'SRC', r: 'uniprot:P12931' } }, { id: 1, v: { n: 'SRC2', r: 'uniprot:P12931' } }],
    edges: [{ id: 0, s: 0, t: 1, v: { Relationships: indraItem({ subject: 'SRC', object: 'SRC', type: 'Complex' }) } }],
  });
  assert.equal(rdf.directTriples.length, 0);
  assert.equal(rdf.reifiedStatements.length, 0);
});

test('declarations sharing an IRI are merged and self-referential aliases dropped', () => {
  const rdf = convert({
    nodeDecls: NCI_PID_NODE_DECLS,
    context: NCI_PID_CONTEXT,
    nodes: [
      { id: 0, v: { n: 'CALM1', r: 'uniprot:P02593', alias: ['uniprot:P02593', 'uniprot:X1'] } },
      { id: 1, v: { n: 'CALM2', r: 'uniprot:P02593', alias: ['uniprot:X2'] } },
    ],
  });
  assert.equal(rdf.nodeDeclarations.length, 1, 'paralogs on one accession are one RDF node');
  const [d] = rdf.nodeDeclarations;
  assert.deepEqual([...d.aliases].sort(), ['uniprot:X1', 'uniprot:X2']);
  assert.equal(d.aliases.includes('uniprot:P02593'), false, 'no owl:sameAs self-reference');
});

test('identical direct triples collapse but reified statements do not', () => {
  const rel = indraItem({ subject: 'SRC', object: 'JUN', type: 'Activation', count: 3 });
  const rdf = convert({
    nodeDecls: NCI_PID_NODE_DECLS,
    context: NCI_PID_CONTEXT,
    nodes: [{ id: 0, v: { n: 'SRC', r: 'uniprot:P12931' } }, { id: 1, v: { n: 'JUN', r: 'uniprot:P05412' } }],
    edges: [
      { id: 0, s: 0, t: 1, v: { Relationships: rel } },
      { id: 1, s: 0, t: 1, v: { Relationships: rel } },
    ],
  });
  assert.equal(rdf.directTriples.length, 1, 'RDF is a set');
  assert.equal(rdf.reifiedStatements.length, 2, 'each carries distinct provenance');
});
