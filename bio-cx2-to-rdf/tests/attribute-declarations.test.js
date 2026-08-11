import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAttributeDeclarations,
  normalizeAttributes,
} from '../dist/core/attribute-declarations.js';

test('normalizeAttributes: reads the alias key and returns the canonical name', () => {
  const decls = { represents: { a: 'r', d: 'string' }, name: { a: 'n', d: 'string' } };
  assert.deepEqual(normalizeAttributes({ r: 'uniprot:P01234', n: 'TP53' }, decls), {
    represents: 'uniprot:P01234',
    name: 'TP53',
  });
});

test('normalizeAttributes: falls back to the full name when a non-conforming file uses it', () => {
  const decls = { represents: { a: 'r', d: 'string' } };
  assert.deepEqual(normalizeAttributes({ represents: 'uniprot:P01234' }, decls), {
    represents: 'uniprot:P01234',
  });
});

test('normalizeAttributes: materializes a declared default when the attribute is absent', () => {
  // This is the rule that makes an omitted `type` mean "protein" in NCI-PID.
  // Reading the raw `v` bag instead makes 3,353 typed nodes look untyped.
  const decls = { type: { v: 'protein', d: 'string' } };
  assert.equal(normalizeAttributes({}, decls).type, 'protein');
});

test('normalizeAttributes: an explicit value overrides the declared default', () => {
  const decls = { type: { v: 'protein', d: 'string' } };
  assert.equal(normalizeAttributes({ type: 'smallmolecule' }, decls).type, 'smallmolecule');
});

test('normalizeAttributes: omits an attribute that is absent with no default', () => {
  const decls = { type: { d: 'string' } };
  assert.equal('type' in normalizeAttributes({}, decls), false);
});

test('normalizeAttributes: preserves falsy values and falsy defaults', () => {
  const decls = {
    flag: { v: false, d: 'boolean' },
    count: { v: 0, d: 'integer' },
    label: { v: '', d: 'string' },
  };
  const out = normalizeAttributes({}, decls);
  assert.equal(out.flag, false);
  assert.equal(out.count, 0);
  assert.equal(out.label, '');
});

test('normalizeAttributes: passes undeclared attributes through unchanged', () => {
  const out = normalizeAttributes({ Relationships: '<li/>x', custom: 7 }, {});
  assert.equal(out.Relationships, '<li/>x');
  assert.equal(out.custom, 7);
});

test('normalizeAttributes: an undefined attribute bag yields defaults only', () => {
  assert.deepEqual(normalizeAttributes(undefined, { type: { v: 'protein', d: 'string' } }), {
    type: 'protein',
  });
});

test('parseAttributeDeclarations: extracts per-aspect maps', () => {
  const decls = parseAttributeDeclarations([
    { attributeDeclarations: [{ nodes: { name: { a: 'n', d: 'string' } }, edges: { interaction: { a: 'i', d: 'string' } } }] },
  ]);
  assert.equal(decls.nodes.name.a, 'n');
  assert.equal(decls.edges.interaction.a, 'i');
  assert.deepEqual(decls.networkAttributes, {});
});

test('parseAttributeDeclarations: missing aspect yields empty maps, not a throw', () => {
  const decls = parseAttributeDeclarations([{ nodes: [] }]);
  assert.deepEqual(decls, { nodes: {}, edges: {}, networkAttributes: {} });
});

test('parseAttributeDeclarations: keeps scanning past a malformed entry', () => {
  const decls = parseAttributeDeclarations([
    { attributeDeclarations: ['not an object'] },
    { attributeDeclarations: [{ nodes: { name: { d: 'string' } } }] },
  ]);
  assert.ok('name' in decls.nodes);
});
