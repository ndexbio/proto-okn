#!/usr/bin/env node
/**
 * download-networks.mjs
 *
 * Download a set of NDEx networks (by UUID) in native CX2 format and store them
 * as `.cx2` files. The UUIDs are read from a CSV with a single `network_id`
 * column (the NCI-PID 2.0 pathway network set lives in
 * `data_files/network_list.csv`).
 *
 * Each network is fetched via `@js4cytoscape/ndex-client`'s
 * `client.networks.getRawCX2Network(uuid)`, which performs `GET /v3/networks/{uuid}`
 * and returns the native CX2 aspect array — exactly the on-disk format the
 * `merge_cx2.py` and `bio-cx2-to-rdf` tools consume.
 *
 * Files are named after the network's own name (sanitized) so the merge step can
 * derive pathway names from filenames, falling back to the UUID when a network has
 * no name. A `download-manifest.json` records the uuid -> filename mapping, which
 * also drives resumable re-runs (already-downloaded UUIDs are skipped unless
 * --force is given), and preserves the UUID provenance that filenames lose.
 *
 * Usage:
 *   node download-networks.mjs [options]
 *
 * Options:
 *   --list <path>          CSV of network UUIDs (default: ../data_files/network_list.csv)
 *   --out <dir>            Output directory for .cx2 files (default: ../data_files)
 *   --concurrency <n>      Parallel downloads (default: 4)
 *   --server <url>         NDEx server base URL (default: https://www.ndexbio.org)
 *   --by-uuid             Name files <uuid>.cx2 instead of by network name
 *   --force               Re-download networks already present in the manifest
 *   -h, --help            Show this help
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NDExClient } from '@js4cytoscape/ndex-client';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ----------------------------------------------------------------------------
// Argument parsing
// ----------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    list: resolve(__dirname, '..', 'data_files', 'network_list.csv'),
    out: resolve(__dirname, '..', 'data_files'),
    concurrency: 4,
    server: 'https://www.ndexbio.org',
    byUuid: false,
    force: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--list':
        opts.list = resolve(argv[++i]);
        break;
      case '--out':
        opts.out = resolve(argv[++i]);
        break;
      case '--concurrency':
        opts.concurrency = Math.max(1, parseInt(argv[++i], 10) || 1);
        break;
      case '--server':
        opts.server = argv[++i];
        break;
      case '--by-uuid':
        opts.byUuid = true;
        break;
      case '--force':
        opts.force = true;
        break;
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        printHelp();
        process.exit(1);
    }
  }
  return opts;
}

function printHelp() {
  console.log(
    `Download NDEx networks (by UUID) as native CX2 files.\n\n` +
      `Usage: node download-networks.mjs [options]\n\n` +
      `  --list <path>      CSV of network UUIDs (default: ../data_files/network_list.csv)\n` +
      `  --out <dir>        Output directory (default: ../data_files)\n` +
      `  --concurrency <n>  Parallel downloads (default: 4)\n` +
      `  --server <url>     NDEx server base URL (default: https://www.ndexbio.org)\n` +
      `  --by-uuid          Name files <uuid>.cx2 instead of by network name\n` +
      `  --force            Re-download networks already in the manifest\n` +
      `  -h, --help         Show this help`
  );
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Parse the UUID list from a CSV whose single column is `network_id`.
 * Tolerates a quoted header, surrounding quotes, blank lines, and duplicates.
 */
function parseUuidList(csv) {
  const seen = new Set();
  const uuids = [];
  for (const rawLine of csv.split(/\r?\n/)) {
    const value = rawLine.trim().replace(/^"+|"+$/g, '').trim();
    if (!value) continue;
    if (value.toLowerCase() === 'network_id') continue; // header
    if (seen.has(value)) continue;
    seen.add(value);
    uuids.push(value);
  }
  return uuids;
}

/** Read the network name out of the raw CX2 `networkAttributes` aspect. */
function networkNameFromCx2(cx2) {
  if (!Array.isArray(cx2)) return undefined;
  for (const aspect of cx2) {
    if (aspect && typeof aspect === 'object' && Array.isArray(aspect.networkAttributes)) {
      const attrs = aspect.networkAttributes[0];
      if (attrs && typeof attrs.name === 'string' && attrs.name.trim()) {
        return attrs.name.trim();
      }
    }
  }
  return undefined;
}

/** Make a filesystem-safe base name (no extension). */
function sanitizeFilename(name) {
  return name
    .replace(/[\/\\:*?"<>|]/g, '_') // characters illegal on common filesystems
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '') // no leading dots
    .slice(0, 180); // keep well under filesystem limits
}

/** Simple bounded-concurrency map over a list. */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function loadManifest(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(await readFile(path, 'utf-8'));
  } catch {
    console.warn(`Could not parse existing manifest at ${path}; starting fresh.`);
    return {};
  }
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  console.error(`List:        ${opts.list}`);
  console.error(`Output:      ${opts.out}`);
  console.error(`Server:      ${opts.server}`);
  console.error(`Concurrency: ${opts.concurrency}`);

  const csv = await readFile(opts.list, 'utf-8');
  const uuids = parseUuidList(csv);
  console.error(`Networks to process: ${uuids.length}\n`);

  await mkdir(opts.out, { recursive: true });

  const manifestPath = join(opts.out, 'download-manifest.json');
  const manifest = await loadManifest(manifestPath);

  const client = new NDExClient({ baseURL: opts.server });

  // Reserve filenames already claimed in the manifest so a fresh run doesn't
  // collide with files from a previous run.
  const usedNames = new Set(Object.values(manifest).map((e) => e.file));

  let downloaded = 0;
  let skipped = 0;
  const failures = [];

  await mapWithConcurrency(uuids, opts.concurrency, async (uuid, idx) => {
    const tag = `[${idx + 1}/${uuids.length}] ${uuid}`;

    if (!opts.force && manifest[uuid] && existsSync(join(opts.out, manifest[uuid].file))) {
      console.error(`${tag} — skip (already downloaded as ${manifest[uuid].file})`);
      skipped++;
      return;
    }

    try {
      const cx2 = await client.networks.getRawCX2Network(uuid);

      const name = networkNameFromCx2(cx2);
      let base = opts.byUuid || !name ? uuid : sanitizeFilename(name) || uuid;

      // Disambiguate name collisions across different UUIDs.
      let file = `${base}.cx2`;
      if (!opts.byUuid) {
        const prevFile = manifest[uuid]?.file;
        while (usedNames.has(file) && file !== prevFile) {
          base = `${sanitizeFilename(name) || uuid}_${uuid.slice(0, 8)}`;
          file = `${base}.cx2`;
        }
      }
      usedNames.add(file);

      await writeFile(join(opts.out, file), JSON.stringify(cx2), 'utf-8');
      manifest[uuid] = { file, name: name ?? null };
      downloaded++;
      console.error(`${tag} — saved ${file}${name ? ` ("${name}")` : ''}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`${tag} — FAILED: ${message}`);
      failures.push({ uuid, message });
    }
  });

  // Persist the manifest (best effort, even on partial failure) for resumability.
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

  console.error(
    `\nDone. downloaded=${downloaded} skipped=${skipped} failed=${failures.length} ` +
      `total=${uuids.length}`
  );
  console.error(`Manifest: ${manifestPath}`);

  if (failures.length > 0) {
    console.error(`\nFailures:`);
    for (const f of failures) console.error(`  ${f.uuid}: ${f.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Fatal: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});
