/**
 * Turtle RDF Writer using N3.js
 */

import { Writer, DataFactory } from 'n3';
import type {
  RdfOutput,
  NodeDeclaration,
  RdfTriple,
  ReifiedStatement,
  NamespaceMap,
} from './types.js';
import { expandUri, resolvePrefix, NDEX_VOCAB_BASE } from './namespace-manager.js';
import { toSafeIri } from './uri-builder.js';

const { namedNode, literal } = DataFactory;

/**
 * Standard RDF/RDFS/OWL URIs
 */
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
const RDF_SUBJECT = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#subject';
const RDF_PREDICATE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#predicate';
const RDF_OBJECT = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#object';
const RDF_STATEMENT = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#Statement';
const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label';
const OWL_SAMEAS = 'http://www.w3.org/2002/07/owl#sameAs';
const SKOS_EXACT_MATCH = 'http://www.w3.org/2004/02/skos/core#exactMatch';

/**
 * Vocabulary terms this converter defines. Under the NDEx vocab base, not the
 * retired `example.org` placeholder — see namespace-manager.ts.
 */
const OKN_EVIDENCE_COUNT = `${NDEX_VOCAB_BASE}evidenceCount`;
const OKN_EVIDENCE_URL = `${NDEX_VOCAB_BASE}evidenceUrl`;
const OKN_PROCESS_TYPE = `${NDEX_VOCAB_BASE}processType`;
const OKN_IN_PATHWAY = `${NDEX_VOCAB_BASE}inPathway`;

/**
 * Write RDF output to Turtle format
 */
export function writeToTurtle(rdfOutput: RdfOutput): Promise<string> {
  return new Promise((resolve, reject) => {
    const writer = new Writer({ prefixes: rdfOutput.namespaces });

    try {
      // Write node declarations
      for (const node of rdfOutput.nodeDeclarations) {
        writeNodeDeclaration(writer, node, rdfOutput.namespaces);
      }

      // Write direct triples
      for (const triple of rdfOutput.directTriples) {
        writeDirectTriple(writer, triple, rdfOutput.namespaces);
      }

      // Write reified statements
      for (const statement of rdfOutput.reifiedStatements) {
        writeReifiedStatement(writer, statement, rdfOutput.namespaces);
      }

      writer.end((error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Write node declaration triples
 */
function writeNodeDeclaration(
  writer: Writer,
  node: NodeDeclaration,
  namespaces: NamespaceMap
): void {
  const subjectUri = resolveUri(node.uri, namespaces);

  // Type triple (omitted when the CX2 type was missing or unrecognized — the
  // adapter warns in that case rather than defaulting to a class)
  if (node.type) {
    writer.addQuad(
      namedNode(subjectUri),
      namedNode(RDF_TYPE),
      namedNode(node.type)
    );
  }

  // Label triple (only when a label is present; avoid emitting empty literals)
  if (node.label) {
    writer.addQuad(
      namedNode(subjectUri),
      namedNode(RDFS_LABEL),
      literal(node.label)
    );
  }

  // Alias triples (owl:sameAs)
  if (node.aliases) {
    for (const alias of node.aliases) {
      const aliasUri = resolveUri(alias, namespaces);
      writer.addQuad(
        namedNode(subjectUri),
        namedNode(OWL_SAMEAS),
        namedNode(aliasUri)
      );
    }
  }

  // Equivalent identifiers from node normalization. skos:exactMatch rather than
  // owl:sameAs: these are cross-vocabulary identifier equivalences asserted by a
  // third-party normalizer, not OWL-strength claims that every property carries
  // over — and a reasoner acting on sameAs would merge cliques we deliberately
  // kept apart (see the retinal isomers in scripts/normalize-chemicals.js).
  if (node.exactMatch) {
    for (const match of node.exactMatch) {
      writer.addQuad(
        namedNode(subjectUri),
        namedNode(SKOS_EXACT_MATCH),
        namedNode(resolveUri(match, namespaces))
      );
    }
  }
}

/**
 * Write direct relationship triple
 */
function writeDirectTriple(
  writer: Writer,
  triple: RdfTriple,
  namespaces: NamespaceMap
): void {
  const subjectUri = resolveUri(triple.subject, namespaces);
  const objectUri = resolveUri(triple.object, namespaces);

  writer.addQuad(
    namedNode(subjectUri),
    namedNode(triple.predicate),
    namedNode(objectUri)
  );
}

/**
 * Write reified statement with metadata
 */
function writeReifiedStatement(
  writer: Writer,
  statement: ReifiedStatement,
  namespaces: NamespaceMap
): void {
  const statementNode = namedNode(statement.statementUri);
  const subjectUri = resolveUri(statement.subject, namespaces);
  const objectUri = resolveUri(statement.object, namespaces);

  // Statement type
  writer.addQuad(statementNode, namedNode(RDF_TYPE), namedNode(RDF_STATEMENT));

  // Subject, predicate, object
  writer.addQuad(statementNode, namedNode(RDF_SUBJECT), namedNode(subjectUri));
  writer.addQuad(statementNode, namedNode(RDF_PREDICATE), namedNode(statement.predicate));
  writer.addQuad(statementNode, namedNode(RDF_OBJECT), namedNode(objectUri));

  // Evidence count
  writer.addQuad(
    statementNode,
    namedNode(OKN_EVIDENCE_COUNT),
    literal(statement.evidenceCount.toString(), namedNode('http://www.w3.org/2001/XMLSchema#integer'))
  );

  // Evidence URL (free-form INDRA URL; percent-encode IRI-illegal chars such as
  // spaces so the emitted IRI is valid Turtle)
  writer.addQuad(
    statementNode,
    namedNode(OKN_EVIDENCE_URL),
    namedNode(toSafeIri(statement.evidenceUrl))
  );

  // Process type (if present)
  if (statement.processType) {
    writer.addQuad(
      statementNode,
      namedNode(OKN_PROCESS_TYPE),
      namedNode(statement.processType)
    );
  }

  // Pathway membership (if any): the pathway(s) this interaction belongs to
  if (statement.inPathways) {
    for (const pathwayUri of statement.inPathways) {
      writer.addQuad(
        statementNode,
        namedNode(OKN_IN_PATHWAY),
        namedNode(resolveUri(pathwayUri, namespaces))
      );
    }
  }
}

/**
 * Resolve prefixed URI to full URI
 */
function resolveUri(uri: string, namespaces: NamespaceMap): string {
  // Already a full URI
  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    return uri;
  }

  // Try to expand prefixed form. Prefix resolution is case-insensitive: CX2 files
  // declare `chebi:` in @context but write `CHEBI:` on nodes, and an exact-only
  // match left those as relative, scheme-less IRIs.
  const colonIndex = uri.indexOf(':');
  if (colonIndex !== -1 && resolvePrefix(uri.substring(0, colonIndex), namespaces)) {
    return expandUri(uri, namespaces);
  }

  // Return as-is (will likely fail validation)
  return uri;
}

/**
 * Write RDF output to string synchronously (blocking)
 */
export function writeToTurtleSync(rdfOutput: RdfOutput): string {
  const chunks: string[] = [];

  const writer = new Writer({
    prefixes: rdfOutput.namespaces,
    end: false,
  });

  // Write node declarations
  for (const node of rdfOutput.nodeDeclarations) {
    writeNodeDeclaration(writer, node, rdfOutput.namespaces);
  }

  // Write direct triples
  for (const triple of rdfOutput.directTriples) {
    writeDirectTriple(writer, triple, rdfOutput.namespaces);
  }

  // Write reified statements
  for (const statement of rdfOutput.reifiedStatements) {
    writeReifiedStatement(writer, statement, rdfOutput.namespaces);
  }

  // Get result
  let result = '';
  writer.end((error, output) => {
    if (error) throw error;
    result = output;
  });

  return result;
}
