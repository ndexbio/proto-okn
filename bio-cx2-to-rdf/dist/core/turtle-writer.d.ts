/**
 * Turtle RDF Writer using N3.js
 */
import type { RdfOutput } from './types.js';
/**
 * Write RDF output to Turtle format
 */
export declare function writeToTurtle(rdfOutput: RdfOutput): Promise<string>;
/**
 * Write RDF output to string synchronously (blocking)
 */
export declare function writeToTurtleSync(rdfOutput: RdfOutput): string;
//# sourceMappingURL=turtle-writer.d.ts.map