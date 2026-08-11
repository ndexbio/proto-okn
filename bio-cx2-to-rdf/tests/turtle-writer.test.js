import test from 'node:test';
import assert from 'node:assert/strict';
import { writeToTurtle } from '../dist/core/turtle-writer.js';
import { createNamespaceMap } from '../dist/core/namespace-manager.js';

const NS = createNamespaceMap({});
const base = (over = {}) => ({
  namespaces: NS,
  nodeDeclarations: [],
  directTriples: [],
  reifiedStatements: [],
  ...over,
});

test('emits rdf:type, rdfs:label and owl:sameAs for a declared node', async () => {
  const ttl = await writeToTurtle(
    base({
      nodeDeclarations: [
        {
          uri: 'uniprot:P04637',
          label: 'TP53',
          type: 'http://semanticscience.org/resource/SIO_010043',
          aliases: ['uniprot:Q00987'],
        },
      ],
    })
  );
  assert.match(ttl, /uniprot:P04637 a SIO:010043/);
  assert.match(ttl, /rdfs:label "TP53"/);
  assert.match(ttl, /owl:sameAs uniprot:Q00987/);
});

test('omits rdf:type entirely when the node has no class', async () => {
  const ttl = await writeToTurtle(
    base({ nodeDeclarations: [{ uri: 'uniprot:P04637', label: 'TP53' }] })
  );
  assert.match(ttl, /rdfs:label "TP53"/);
  assert.equal(/\ba\s+\S*SIO/.test(ttl), false, 'must not invent a class');
});

test('omits an empty label rather than emitting an empty literal', async () => {
  const ttl = await writeToTurtle(
    base({ nodeDeclarations: [{ uri: 'uniprot:P1', type: 'http://x.test/C' }] })
  );
  assert.equal(ttl.includes('rdfs:label'), false);
});

test('emits skos:exactMatch for normalization equivalences', async () => {
  const ttl = await writeToTurtle(
    base({
      nodeDeclarations: [
        {
          uri: 'http://rdf.ncbi.nlm.nih.gov/pubchem/compound/CID305',
          label: 'choline',
          type: 'http://purl.obolibrary.org/obo/CHEBI_23367',
          exactMatch: ['http://purl.obolibrary.org/obo/CHEBI_15354'],
        },
      ],
    })
  );
  assert.match(ttl, /skos:exactMatch/);
  assert.match(ttl, /chebi:15354/);
});

test('exactMatch is used instead of owl:sameAs for cross-vocabulary equivalence', async () => {
  // sameAs is OWL-strength; a reasoner acting on it would merge cliques that
  // curated overrides deliberately keep apart.
  const ttl = await writeToTurtle(
    base({
      nodeDeclarations: [
        { uri: 'chebi:1', type: 'http://x.test/C', exactMatch: ['http://purl.obolibrary.org/obo/CHEBI_2'] },
      ],
    })
  );
  assert.equal(ttl.includes('owl:sameAs'), false);
});

test('percent-encodes IRI-illegal characters in a free-form evidence URL', async () => {
  const ttl = await writeToTurtle(
    base({
      reifiedStatements: [
        {
          statementUri: 'https://www.ndexbio.org/identifiers/statement_1_0',
          subject: 'uniprot:P1',
          predicate: 'http://purl.obolibrary.org/obo/RO_0002436',
          object: 'uniprot:P2',
          evidenceCount: 4,
          evidenceUrl: 'https://db.indra.bio/x?a=b c',
        },
      ],
    })
  );
  assert.match(ttl, /a=b%20c/, 'a raw space would make the Turtle invalid');
});

test('reified statements use the NDEx vocabulary namespace, not example.org', async () => {
  const ttl = await writeToTurtle(
    base({
      reifiedStatements: [
        {
          statementUri: 'https://www.ndexbio.org/identifiers/statement_1_0',
          subject: 'uniprot:P1',
          predicate: 'http://purl.obolibrary.org/obo/RO_0002436',
          object: 'uniprot:P2',
          evidenceCount: 4,
          evidenceUrl: 'https://db.indra.bio/x',
          processType: 'http://purl.obolibrary.org/obo/GO_0016925',
          inPathways: ['https://www.ndexbio.org/identifiers/pathway/p1'],
        },
      ],
    })
  );
  assert.equal(ttl.includes('example.org'), false);
  for (const term of ['evidenceCount', 'evidenceUrl', 'processType', 'inPathway']) {
    assert.match(ttl, new RegExp(`ncipidv:${term}`), `${term} must live under the NDEx vocab base`);
  }
});

test('evidence count is typed as xsd:integer', async () => {
  const ttl = await writeToTurtle(
    base({
      reifiedStatements: [
        {
          statementUri: 'https://www.ndexbio.org/identifiers/statement_1_0',
          subject: 'uniprot:P1',
          predicate: 'http://purl.obolibrary.org/obo/RO_0002436',
          object: 'uniprot:P2',
          evidenceCount: 4,
          evidenceUrl: 'https://db.indra.bio/x',
        },
      ],
    })
  );
  assert.match(ttl, /ncipidv:evidenceCount 4/);
});

test('a CURIE whose prefix differs in case still serializes as an absolute IRI', async () => {
  const ttl = await writeToTurtle(
    base({ nodeDeclarations: [{ uri: 'CHEBI:16618', type: 'http://x.test/C' }] })
  );
  assert.equal(/<CHEBI:16618>/.test(ttl), false, 'must not emit a relative IRI');
  assert.match(ttl, /chebi:16618/);
});
