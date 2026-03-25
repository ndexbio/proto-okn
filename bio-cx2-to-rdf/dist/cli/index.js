#!/usr/bin/env node
/**
 * bio-cx2-to-rdf CLI
 * Convert NCI-PID CX2 networks to RDF Turtle format
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { parseCX2, getCX2Version, getNodeCount, getEdgeCount } from '../core/cx2-parser.js';
import { convertToRdf } from '../adapters/nci-pid/index.js';
import { writeToTurtle } from '../core/turtle-writer.js';
const program = new Command();
program
    .name('bio-cx2-to-rdf')
    .description('Convert NCI-PID CX2 networks to RDF Turtle format')
    .version('1.0.0')
    .argument('<input>', 'Input CX2 file path')
    .option('-o, --output <path>', 'Output Turtle file path')
    .option('--uuid <uuid>', 'Network UUID for statement URIs')
    .option('-v, --verbose', 'Verbose output')
    .action(async (input, options) => {
    try {
        // Resolve input path
        const inputPath = resolve(input);
        // Read input file
        if (options.verbose) {
            console.error(`Reading: ${inputPath}`);
        }
        const content = await readFile(inputPath, 'utf-8');
        // Check CX2 version
        const version = getCX2Version(content);
        if (options.verbose && version) {
            console.error(`CX2 Version: ${version}`);
        }
        // Parse CX2
        const parsed = parseCX2(content);
        if (options.verbose) {
            console.error(`Nodes: ${getNodeCount(parsed)}`);
            console.error(`Edges: ${getEdgeCount(parsed)}`);
            if (parsed.networkAttributes.name) {
                console.error(`Network: ${parsed.networkAttributes.name}`);
            }
        }
        // Convert to RDF
        const rdfOutput = convertToRdf(parsed);
        if (options.verbose) {
            console.error(`Node declarations: ${rdfOutput.nodeDeclarations.length}`);
            console.error(`Direct triples: ${rdfOutput.directTriples.length}`);
            console.error(`Reified statements: ${rdfOutput.reifiedStatements.length}`);
        }
        // Write Turtle output
        const turtle = await writeToTurtle(rdfOutput);
        // Determine output path
        if (options.output) {
            const outputPath = resolve(options.output);
            await writeFile(outputPath, turtle, 'utf-8');
            if (options.verbose) {
                console.error(`Written: ${outputPath}`);
            }
        }
        else {
            // Write to stdout
            console.log(turtle);
        }
    }
    catch (error) {
        if (error instanceof Error) {
            console.error(`Error: ${error.message}`);
            if (options.verbose) {
                console.error(error.stack);
            }
        }
        else {
            console.error('Unknown error occurred');
        }
        process.exit(1);
    }
});
program.parse();
//# sourceMappingURL=index.js.map