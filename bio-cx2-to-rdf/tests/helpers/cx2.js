/**
 * Fixture builders for CX2 aspect arrays.
 *
 * Tests exercise the compiled `dist/` output rather than `src/`, because
 * `tsconfig.json` excludes `tests/` from the build — so the suite runs against
 * exactly the JavaScript the CLI ships. `npm test` builds first.
 */

/**
 * Build a CX2 aspect array.
 *
 * @param {object} opts
 * @param {object} [opts.nodeDecls]  attributeDeclarations.nodes (aliases/defaults)
 * @param {object} [opts.edgeDecls]  attributeDeclarations.edges
 * @param {Array}  [opts.nodes]      raw node entries ({id, v})
 * @param {Array}  [opts.edges]      raw edge entries ({id, s, t, v})
 * @param {object} [opts.context]    @context prefix map; omit for no @context at all
 * @param {string} [opts.name]       network name
 */
export function cx2({ nodeDecls, edgeDecls, nodes = [], edges = [], context, name = 'test network' } = {}) {
  const networkAttributes = { name };
  if (context !== undefined) {
    networkAttributes['@context'] = JSON.stringify(context);
  }
  return [
    { CXVersion: '2.0' },
    {
      attributeDeclarations: [
        {
          nodes: nodeDecls ?? {},
          edges: edgeDecls ?? {},
          networkAttributes: {},
        },
      ],
    },
    { networkAttributes: [networkAttributes] },
    { nodes },
    { edges },
  ];
}

/** Serialize a fixture the way `parseCX2` expects it. */
export function cx2Json(opts) {
  return JSON.stringify(cx2(opts));
}

/** The @context NCI-PID per-pathway networks actually ship (note lowercase `chebi`). */
export const NCI_PID_CONTEXT = {
  ndex: 'https://www.ndexbio.org/v3/networks/',
  chebi: 'https://identifiers.org/chebi/CHEBI:',
  uniprot: 'https://identifiers.org/uniprot/',
  cas: 'https://identifiers.org/cas/',
  'hgnc.symbol': 'https://identifiers.org/hgnc.symbol/',
};

/** The declaration block NCI-PID per-pathway files carry, including the type default. */
export const NCI_PID_NODE_DECLS = {
  represents: { a: 'r', d: 'string' },
  name: { a: 'n', d: 'string' },
  alias: { d: 'list_of_string' },
  member: { d: 'list_of_string' },
  type: { v: 'protein', d: 'string' },
};

/** Build one `<li/>…(<a href=…>N</a>)` INDRA relationship item. */
export function indraItem({ subject, object, type, count = 1 }) {
  const url =
    `https://db.indra.bio/statements/from_agents?subject=${subject}` +
    `&object=${object}&type=${type}&format=html&expand_all=true`;
  return `<li/>${subject} ${type} ${object}(<a href="${url}" target="_blank">${count}</a>)`;
}

/** Index a converter result's node declarations by subject IRI. */
export function declByUri(rdf) {
  return new Map(rdf.nodeDeclarations.map((d) => [d.uri, d]));
}

/** True when any emitted IRI in the output is relative (no scheme). */
export function collectSubjectIris(rdf) {
  return [
    ...rdf.nodeDeclarations.map((d) => d.uri),
    ...rdf.directTriples.flatMap((t) => [t.subject, t.object]),
    ...rdf.reifiedStatements.flatMap((s) => [s.statementUri, s.subject, s.object]),
  ];
}
