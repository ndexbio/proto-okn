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
import { expandUri } from './namespace-manager.js';

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

/**
 * OKN custom predicates
 */
const OKN_EVIDENCE_COUNT = 'http://example.org/okn/evidenceCount';
const OKN_EVIDENCE_URL = 'http://example.org/okn/evidenceUrl';
const OKN_PROCESS_TYPE = 'http://example.org/okn/processType';
const OKN_IN_PATHWAY = 'http://example.org/okn/inPathway';

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

  // Type triple
  writer.addQuad(
    namedNode(subjectUri),
    namedNode(RDF_TYPE),
    namedNode(node.type)
  );

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

  // Evidence URL
  writer.addQuad(
    statementNode,
    namedNode(OKN_EVIDENCE_URL),
    namedNode(statement.evidenceUrl)
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

  // Try to expand prefixed form
  const colonIndex = uri.indexOf(':');
  if (colonIndex !== -1) {
    const prefix = uri.substring(0, colonIndex);
    if (prefix in namespaces) {
      return expandUri(uri, namespaces);
    }
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
