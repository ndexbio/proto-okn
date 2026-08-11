import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCX2, getCX2Version, getNodeCount, getEdgeCount } from '../dist/core/cx2-parser.js';
import { cx2Json, NCI_PID_CONTEXT, NCI_PID_NODE_DECLS } from './helpers/cx2.js';

test('parseCX2: resolves node aliases and materializes the type default', () => {
  const parsed = parseCX2(
    cx2Json({
      nodeDecls: NCI_PID_NODE_DECLS,
      context: NCI_PID_CONTEXT,
      nodes: [{ id: 0, v: { n: 'TP53', r: 'uniprot:P04637' } }],
    })
  );
  const [node] = parsed.nodes;
  assert.equal(node.v.name, 'TP53');
  assert.equal(node.v.represents, 'uniprot:P04637');
  assert.equal(node.v.type, 'protein', 'omitted type must inherit the declared default');
});

test('parseCX2: an explicit type overrides the declared default', () => {
  const parsed = parseCX2(
    cx2Json({
      nodeDecls: NCI_PID_NODE_DECLS,
      nodes: [{ id: 0, v: { n: 'choline', r: 'CHEBI:15354', type: 'smallmolecule' } }],
    })
  );
  assert.equal(parsed.nodes[0].v.type, 'smallmolecule');
});

test('parseCX2: nodes with no type declaration default stay untyped', () => {
  // The merged NCI-PID networks omit `{"type": {"v": "protein"}}`.
  const parsed = parseCX2(
    cx2Json({
      nodeDecls: { represents: { d: 'string' }, name: { d: 'string' }, type: { d: 'string' } },
      nodes: [{ id: 0, v: { name: 'THY1', represents: 'uniprot:P04216' } }],
    })
  );
  assert.equal(parsed.nodes[0].v.type, undefined);
});

test('parseCX2: parses @context into the namespace map', () => {
  const parsed = parseCX2(cx2Json({ context: NCI_PID_CONTEXT }));
  assert.equal(parsed.context.chebi, 'https://identifiers.org/chebi/CHEBI:');
});

test('parseCX2: a network with no @context yields an empty context, not a throw', () => {
  const parsed = parseCX2(cx2Json({ nodes: [{ id: 0, v: { name: 'X', represents: 'uniprot:P1' } }] }));
  assert.deepEqual(parsed.context, {});
});

test('parseCX2: malformed @context JSON is tolerated', () => {
  const aspects = JSON.parse(cx2Json({}));
  aspects.find((a) => a.networkAttributes).networkAttributes[0]['@context'] = '{not json';
  assert.deepEqual(parseCX2(JSON.stringify(aspects)).context, {});
});

test('parseCX2: builds id -> uri and id -> name lookups', () => {
  const parsed = parseCX2(
    cx2Json({
      nodeDecls: NCI_PID_NODE_DECLS,
      nodes: [
        { id: 0, v: { n: 'TP53', r: 'uniprot:P04637' } },
        { id: 1, v: { n: 'MDM2', r: 'uniprot:Q00987' } },
      ],
    })
  );
  assert.equal(parsed.nodeIdToUri.get(1), 'uniprot:Q00987');
  assert.equal(parsed.nodeIdToName.get(0), 'TP53');
});

test('parseCX2: resolves edge aliases', () => {
  const parsed = parseCX2(
    cx2Json({
      edgeDecls: { interaction: { a: 'i', d: 'string' } },
      edges: [{ id: 0, s: 0, t: 1, v: { i: 'participates in' } }],
    })
  );
  assert.equal(parsed.edges[0].v.interaction, 'participates in');
});

test('getCX2Version / counts', () => {
  const json = cx2Json({
    nodes: [{ id: 0, v: {} }, { id: 1, v: {} }],
    edges: [{ id: 0, s: 0, t: 1, v: {} }],
  });
  assert.equal(getCX2Version(json), '2.0');
  const parsed = parseCX2(json);
  assert.equal(getNodeCount(parsed), 2);
  assert.equal(getEdgeCount(parsed), 1);
});
