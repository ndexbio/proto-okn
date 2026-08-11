#!/usr/bin/env node
/**
 * Normalize CX2 small-molecule identifiers against the RENCI Node Normalizer.
 *
 * Build-time tool, same shape as `refresh-bioregistry.js`: it queries an external
 * service, writes a **committed snapshot**, and is never called during conversion.
 * A pinned snapshot is what keeps conversion deterministic and offline.
 *
 * WHY THIS EXISTS
 * ---------------
 * OKN's biomedical identifier guidance
 * (https://registry.okn.us/book/biomedical-identifiers/) prefers **PubChem CIDs**
 * for chemical entities, and calls CAS registry numbers "imprecise". NCI-PID CX2
 * networks carry `type: "smallmolecule"` nodes identified by `CHEBI:` or `cas:`
 * CURIEs, so neither identifier space matches the preferred one. The same page
 * points at the RENCI Node Normalizer as the tool for converting non-preferred
 * identifiers, and it is the **graph producer's** job to run it — FRINK does not
 * normalize uploaded graphs.
 *
 * RESOLUTION POLICY (applied per distinct source identifier)
 *   1. PubChem CID from the normalizer clique  -> preferred subject IRI
 *   2. else ChEBI from the clique              -> fallback subject IRI
 *   3. else the source identifier is kept unchanged (nothing better exists)
 * Every other clique member is retained in the snapshot so the converter can emit
 * them as `skos:exactMatch`, which is what makes step 3 recoverable and keeps the
 * normalizer's lossy merges (see FLAGS) auditable rather than silent.
 *
 * FLAGS raised for human review (the reason this emits a table, not just a map)
 *   COLLISION    two or more DISTINCT source identifiers normalize onto the same
 *                chosen identifier. Accepting these silently merges two CX2 nodes
 *                into one RDF entity, which can turn a real reaction into a
 *                self-loop — in NCI-PID, 11-cis-retinal and all-trans-retinal both
 *                collapse to PubChem CID 638015 ("Retinal"), and their
 *                isomerization *is* the phototransduction event. Highest priority.
 *   CHEBI-DRIFT  clique's ChEBI differs from the source ChEBI. The normalizer
 *                merges stereoisomers and salts, and occasionally errs outright
 *                (calciol/vitamin D3 -> ergocalciferol/vitamin D2). Review before
 *                accepting.
 *   NO-CID       clique has no PubChem CID; fell back to ChEBI
 *   OK           resolved to a PubChem CID
 *   UNRESOLVED   normalizer does not recognize the identifier. Usually a compound
 *                *class* or mixture (ceramide, sphingomyelin) that has no single
 *                CID, or a bad source CAS number.
 *   NO-ID        node `represents` is a bare name, not a CURIE. Not normalizable.
 *
 * Usage:
 *   node scripts/normalize-chemicals.js [options] [cx2-file-or-dir ...]
 *   npm run normalize:chemicals
 *
 * Options:
 *   --out <dir>     output directory (default: repo-root/chemical-normalization)
 *   --types <list>  comma-separated CX2 node types to collect
 *                   (default: smallmolecule)
 *   --batch <n>     identifiers per normalizer request (default: 200)
 *   --offline       skip the network call; re-render tables from an existing
 *                   snapshot.json (useful for reviewing without re-querying)
 *
 * Outputs (in --out):
 *   snapshot.json   full normalizer result per identifier — the durable artifact
 *   review.tsv      one row per distinct identifier, for spreadsheet review
 *   review.md       same table as Markdown, plus per-flag summary counts
 *
 * Reuses the compiled `dist/core/cx2-parser.js` on purpose: CX2 attribute values
 * are governed by `attributeDeclarations` aliases and defaults, and re-implementing
 * that resolution here is exactly the mistake that makes a node's `type` look absent
 * when it is merely defaulted. Run `npm run build` first.
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(HERE, '..');
const REPO_ROOT = join(PKG_ROOT, '..');

const NODE_NORM_URL =
  'https://nodenormalization-sri.renci.org/get_normalized_nodes';

/** Bioregistry-canonical RDF stems for the identifier spaces this tool emits. */
const IRI_STEMS = {
  'PUBCHEM.COMPOUND': 'http://rdf.ncbi.nlm.nih.gov/pubchem/compound/CID',
  CHEBI: 'http://purl.obolibrary.org/obo/CHEBI_',
};

/**
 * Curated corrections applied on top of the normalizer's answer.
 *
 * The normalizer is a heuristic over identifier cliques and is wrong often enough
 * that its output must be reviewed, not trusted. Each entry records a decision a
 * human made after reading `review.md`, with the evidence for it, so the snapshot
 * stays reproducible and the reasoning is not lost.
 *
 *   keep    - reject the normalizer's choice; use this identifier instead
 *   queryAs - the SOURCE identifier is wrong; normalize this corrected one instead
 */
const OVERRIDES = {
  'CHEBI:16066': {
    keep: 'CHEBI:16066',
    reason:
      'COLLISION: normalizes to PUBCHEM.COMPOUND:638015 ("Retinal"), the same CID as ' +
      'CHEBI:17898 (all-trans-retinal). 11-cis -> all-trans isomerization is the ' +
      'photon-detection step of visual signal transduction; merging the two would ' +
      'reduce the pathway\'s central reaction to a self-loop.',
  },
  'CHEBI:17898': {
    keep: 'CHEBI:17898',
    reason:
      'COLLISION: shares PUBCHEM.COMPOUND:638015 with CHEBI:16066 (11-cis-retinal). ' +
      'See that entry.',
  },
  'CHEBI:28940': {
    keep: 'CHEBI:28940',
    reason:
      'WRONG COMPOUND: calciol is vitamin D3 (cholecalciferol), but the clique ' +
      'resolves to CHEBI:27300 / PUBCHEM.COMPOUND:5280793, both verified as ' +
      'ergocalciferol (vitamin D2). D2 is not D3.',
  },
  'cas:17-18-8': {
    queryAs: 'CAS:70-18-8',
    reason:
      'SOURCE DATA ERROR: the CX2 records glutathione as CAS 17-18-8, which is not a ' +
      'valid registry number. Glutathione is CAS 70-18-8 (CHEBI:16856).',
  },
};

/**
 * The normalizer is case-sensitive on prefixes; CX2 `@context` prefixes are not
 * consistently cased (NCI-PID writes `CHEBI:` in nodes but declares `chebi:`).
 * Map a source CURIE prefix onto the prefix the normalizer indexes.
 */
const PREFIX_CASE = { chebi: 'CHEBI', cas: 'CAS', 'kegg.compound': 'KEGG.COMPOUND' };

function toNormalizerCurie(identifier) {
  const override = OVERRIDES[identifier];
  if (override?.queryAs) return override.queryAs;
  const colon = identifier.indexOf(':');
  if (colon === -1) return null; // bare name — nothing to normalize
  const prefix = identifier.slice(0, colon);
  const local = identifier.slice(colon + 1);
  return `${PREFIX_CASE[prefix.toLowerCase()] ?? prefix}:${local}`;
}

/** Expand a CURIE to a full IRI when the stem is known, else return it unchanged. */
function toIri(curie) {
  const colon = curie.indexOf(':');
  if (colon === -1) return curie;
  const stem = IRI_STEMS[curie.slice(0, colon)];
  return stem ? stem + curie.slice(colon + 1) : curie;
}

/** Recursively collect .cx2 files from a path that may be a file or a directory. */
async function collectCx2Files(target) {
  const stat = existsSync(target) ? await readdir(target).catch(() => null) : null;
  if (stat === null) {
    return extname(target).toLowerCase() === '.cx2' ? [target] : [];
  }
  const out = [];
  for (const entry of stat) {
    if (extname(entry).toLowerCase() === '.cx2') out.push(join(target, entry));
  }
  return out;
}

/**
 * Collect distinct chemical identifiers across the given CX2 files.
 * Returns a Map keyed by the source identifier, carrying display names, the
 * networks it appears in, and an instance count.
 */
async function collectChemicalNodes(files, types, parseCX2) {
  const byIdentifier = new Map();
  let scanned = 0;

  for (const file of files) {
    let parsed;
    try {
      parsed = parseCX2(await readFile(file, 'utf-8'));
    } catch (err) {
      console.error(`  skipped ${basename(file)}: ${err.message}`);
      continue;
    }
    scanned++;

    for (const node of parsed.nodes) {
      const type = node.v.type;
      if (typeof type !== 'string' || !types.has(type.toLowerCase())) continue;

      // `represents` is absent on some nodes; fall back to the display name so the
      // entity still appears in the review table flagged NO-ID rather than vanishing.
      const identifier = node.v.represents ?? node.v.name;
      if (!identifier) continue;

      let entry = byIdentifier.get(identifier);
      if (!entry) {
        entry = { identifier, names: new Set(), networks: new Set(), count: 0 };
        byIdentifier.set(identifier, entry);
      }
      if (node.v.name) entry.names.add(node.v.name);
      entry.networks.add(basename(file));
      entry.count++;
    }
  }

  return { byIdentifier, scanned };
}

/** POST one batch of CURIEs to the normalizer. */
async function normalizeBatch(curies) {
  const res = await fetch(NODE_NORM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      curies,
      conflate: true,
      drug_chemical_conflate: true,
    }),
  });
  if (!res.ok) {
    throw new Error(`normalizer returned HTTP ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * Apply the resolution policy to one source identifier and its normalizer result.
 * Returns the review row.
 */
function resolve1(entry, normalized) {
  const sourceCurie = toNormalizerCurie(entry.identifier);
  const row = {
    source: entry.identifier,
    sourceCurie,
    name: [...entry.names][0] ?? '',
    instances: entry.count,
    networks: entry.networks.size,
    flag: '',
    chosen: '',
    chosenIri: '',
    pubchem: '',
    chebi: '',
    normalizedLabel: '',
    exactMatch: [],
  };

  if (!sourceCurie) {
    row.flag = 'NO-ID';
    row.chosen = entry.identifier;
    row.chosenIri = entry.identifier;
    return row;
  }

  if (!normalized) {
    row.flag = 'UNRESOLVED';
    row.chosen = sourceCurie;
    row.chosenIri = toIri(sourceCurie);
    return row;
  }

  const clique = (normalized.equivalent_identifiers ?? []).map((e) => e.identifier);
  const pubchem = clique.find((c) => c.startsWith('PUBCHEM.COMPOUND:'));
  const chebi = clique.find((c) => c.startsWith('CHEBI:'));

  row.pubchem = pubchem ?? '';
  row.chebi = chebi ?? '';
  row.normalizedLabel = normalized.id?.label ?? '';
  row.exactMatch = clique;

  if (pubchem) {
    row.chosen = pubchem;
    row.flag = 'OK';
  } else if (chebi) {
    row.chosen = chebi;
    row.flag = 'NO-CID';
  } else {
    row.chosen = sourceCurie;
    row.flag = 'UNRESOLVED';
  }

  // A ChEBI source whose clique ChEBI differs means the normalizer merged this
  // entity into a broader/different one — the stereoisomer collapse. Flag it over
  // the OK/NO-CID result, because it is the case a human most needs to see.
  if (sourceCurie.startsWith('CHEBI:') && chebi && chebi !== sourceCurie) {
    row.flag = 'CHEBI-DRIFT';
  }

  // A curated decision wins over anything the normalizer returned. Applied last so
  // the rejected value is still visible in the pubchem/chebi columns of the review
  // table — the point is to show what was overridden, not to hide it.
  const override = OVERRIDES[entry.identifier];
  if (override?.keep) {
    row.chosen = override.keep;
    row.flag = 'OVERRIDE';
    row.overrideReason = override.reason;
  } else if (override?.queryAs) {
    row.overrideReason = override.reason;
    row.correctedFrom = entry.identifier;
  }

  row.chosenIri = toIri(row.chosen);
  return row;
}

const TSV_COLUMNS = [
  ['source', 'source_id'],
  ['name', 'cx2_name'],
  ['flag', 'flag'],
  ['chosen', 'chosen_id'],
  ['chosenIri', 'chosen_iri'],
  ['pubchem', 'pubchem_cid'],
  ['chebi', 'chebi_id'],
  ['normalizedLabel', 'normalizer_label'],
  ['collidesWithText', 'collides_with'],
  ['overrideReason', 'override_reason'],
  ['instances', 'node_instances'],
  ['networks', 'networks'],
];

function renderTsv(rows) {
  const lines = [TSV_COLUMNS.map(([, header]) => header).join('\t')];
  for (const r of rows) {
    const flat = { ...r, collidesWithText: (r.collidesWith ?? []).join(' ') };
    lines.push(TSV_COLUMNS.map(([key]) => String(flat[key] ?? '')).join('\t'));
  }
  return lines.join('\n') + '\n';
}

const FLAG_NOTES = {
  COLLISION: 'Two or more distinct source identifiers normalize to this same id — accepting merges separate CX2 nodes into one RDF entity. Resolve before accepting.',
  OVERRIDE: 'A curated decision overrides the normalizer here; see `override_reason`.',
  'CHEBI-DRIFT': 'Normalizer returned a different ChEBI than the source — a stereoisomer/salt/class merge. Review before accepting.',
  'NO-CID': 'No PubChem CID in the clique; using ChEBI.',
  OK: 'Resolved to a PubChem CID (OKN-preferred).',
  UNRESOLVED: 'Normalizer does not recognize this identifier; source kept unchanged.',
  'NO-ID': 'Node has no CURIE identifier (bare name); not normalizable.',
};

// Review priority, worst first — also the table sort order.
const FLAG_ORDER = ['COLLISION', 'CHEBI-DRIFT', 'OVERRIDE', 'NO-CID', 'OK', 'UNRESOLVED', 'NO-ID'];

/**
 * Mark every row whose chosen identifier is shared by another source identifier.
 * Runs after per-row resolution because a collision is a property of the set, not
 * of any single row — it is invisible to `resolve1`. Records the partner ids so
 * the table shows what merged with what.
 */
function flagCollisions(rows) {
  const bySelected = new Map();
  for (const r of rows) {
    if (r.flag === 'UNRESOLVED' || r.flag === 'NO-ID') continue;
    const group = bySelected.get(r.chosen) ?? [];
    group.push(r);
    bySelected.set(r.chosen, group);
  }
  for (const group of bySelected.values()) {
    if (group.length < 2) continue;
    for (const r of group) {
      r.collidesWith = group.filter((o) => o !== r).map((o) => o.source);
      r.flag = 'COLLISION';
    }
  }
  return rows;
}

function renderMarkdown(rows, meta) {
  const counts = {};
  for (const r of rows) counts[r.flag] = (counts[r.flag] ?? 0) + 1;

  const out = [];
  out.push('# Small-molecule identifier normalization — review');
  out.push('');
  out.push(`Generated: ${meta.generated}`);
  out.push(`Source: ${meta.scanned} CX2 file(s), node types \`${meta.types}\``);
  out.push(`Distinct identifiers: ${rows.length} (${meta.instances} node instances)`);
  out.push(`Normalizer: ${NODE_NORM_URL} (conflate + drug_chemical_conflate)`);
  out.push('');
  out.push('Policy: PubChem CID when available, else ChEBI, else the source identifier');
  out.push('is kept. The full clique is recorded in `snapshot.json` for `skos:exactMatch`.');
  out.push('');
  out.push('## Summary');
  out.push('');
  out.push('| Flag | Count | Meaning |');
  out.push('|---|---:|---|');
  for (const flag of FLAG_ORDER) {
    if (!counts[flag]) continue;
    out.push(`| \`${flag}\` | ${counts[flag]} | ${FLAG_NOTES[flag]} |`);
  }
  out.push('');
  out.push('## Rows');
  out.push('');
  out.push('| Source | Name | Flag | Chosen | PubChem | ChEBI | Normalizer label | Collides with | Nodes |');
  out.push('|---|---|---|---|---|---|---|---|---:|');
  for (const r of rows) {
    const cells = [
      `\`${r.source}\``,
      r.name.replace(/\|/g, '\\|'),
      `\`${r.flag}\``,
      r.chosen ? `\`${r.chosen}\`` : '',
      r.pubchem ? r.pubchem.split(':')[1] : '—',
      r.chebi || '—',
      (r.normalizedLabel || '—').replace(/\|/g, '\\|'),
      (r.collidesWith ?? []).map((s) => `\`${s}\``).join(', ') || '—',
      String(r.instances),
    ];
    out.push('| ' + cells.join(' | ') + ' |');
  }
  const overridden = rows.filter((r) => r.overrideReason);
  if (overridden.length) {
    out.push('');
    out.push('## Curated overrides');
    out.push('');
    out.push('Decisions applied on top of the normalizer, with their evidence.');
    out.push('');
    for (const r of overridden) {
      const target = r.correctedFrom
        ? `\`${r.correctedFrom}\` → queried as \`${r.sourceCurie}\``
        : `\`${r.source}\` → kept as \`${r.chosen}\``;
      out.push(`- **${r.name}** — ${target}`);
      out.push(`  ${r.overrideReason}`);
    }
  }

  out.push('');
  return out.join('\n');
}

/**
 * Render the vendored TypeScript module the converter imports at compile time.
 * Same contract as `bioregistry-prefixes.ts`: generated, but committed, so builds
 * need no network and every checkout produces identical IRIs.
 *
 * Only rows that actually change something are emitted — UNRESOLVED and NO-ID rows
 * resolve to their source identifier, so carrying them would just be noise.
 */
function renderTsModule(rows, meta) {
  const mapping = {};
  for (const r of rows) {
    if (r.flag === 'UNRESOLVED' || r.flag === 'NO-ID') continue;

    // Only the ChEBI/PubChem counterpart of THIS entity is carried across, never
    // the whole clique. Two reasons, both learned from emitting the full clique
    // once: (a) most clique members (MESH, UMLS, RXCUI, DrugCentral, …) have no
    // canonical RDF IRI, so they serialize as relative scheme-less IRIs — the very
    // defect this pass exists to remove; (b) `drug_chemical_conflate` pulls in salt
    // and formulation forms, and asserting choline `skos:exactMatch` choline
    // chloride is simply false. The narrow pair is what actually serves the
    // purpose: the subject IRI changed, so record the identifier it changed from.
    // An OVERRIDE row exists precisely because the normalizer's clique is wrong for
    // this entity, so none of it may be carried across. Emitting the counterparts
    // anyway asserted `11-cis-retinal skos:exactMatch all-trans-retinal` — the very
    // conflation the override was written to reject.
    const counterparts =
      r.flag === 'OVERRIDE'
        ? []
        : [r.pubchem, r.chebi].filter((c) => c && c !== r.chosen).map(toIri);

    mapping[r.source] = {
      iri: r.chosenIri,
      label: r.normalizedLabel || undefined,
      exactMatch: [...new Set(counterparts)],
    };
  }
  return `/**
 * Chemical identifier normalization map, keyed by the CX2 \`represents\` value of a
 * \`type: "smallmolecule"\` node.
 *
 * AUTO-GENERATED by scripts/normalize-chemicals.js — do not edit by hand.
 * Regenerate with: npm run normalize:chemicals
 * Fetched: ${meta.generated}
 *
 * Source: RENCI Node Normalizer, plus curated overrides recorded in that script.
 * Policy: PubChem CID (OKN-preferred) > ChEBI > unchanged source identifier.
 * Identifiers with no better target are intentionally ABSENT from this map; the
 * converter falls back to the source identifier for them.
 *
 * \`exactMatch\` holds only this entity's ChEBI/PubChem counterpart — deliberately
 * NOT the whole normalizer clique, which contains identifier spaces with no
 * canonical RDF IRI and, under drug_chemical_conflate, salt and formulation forms
 * that are not exact matches at all. The converter additionally emits the node's
 * original \`represents\` identifier, which it resolves through the network's own
 * @context.
 */
export interface ChemicalNormalization {
  /** Canonical subject IRI to use for this entity. */
  iri: string;
  /** Normalizer's preferred label, when it supplied one. */
  label?: string;
  /** ChEBI/PubChem counterpart as full IRIs, for skos:exactMatch. */
  exactMatch: string[];
}

export const CHEMICAL_NORMALIZATION: Record<string, ChemicalNormalization> = ${JSON.stringify(mapping, null, 2)};
`;
}

function parseArgs(argv) {
  const opts = {
    out: join(REPO_ROOT, 'chemical-normalization'),
    types: new Set(['smallmolecule']),
    batch: 200,
    offline: false,
    targets: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = resolve(argv[++i]);
    else if (a === '--types')
      opts.types = new Set(argv[++i].split(',').map((t) => t.trim().toLowerCase()));
    else if (a === '--batch') opts.batch = Number(argv[++i]);
    else if (a === '--offline') opts.offline = true;
    else if (a.startsWith('--')) throw new Error(`unknown option: ${a}`);
    else opts.targets.push(resolve(a));
  }
  if (opts.targets.length === 0) {
    // Default corpus: the downloaded per-pathway networks plus any merged
    // networks sitting at the repo root.
    opts.targets = [join(REPO_ROOT, 'data_files'), REPO_ROOT];
  }
  if (!Number.isFinite(opts.batch) || opts.batch < 1) {
    throw new Error('--batch must be a positive number');
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const parserPath = join(PKG_ROOT, 'dist', 'core', 'cx2-parser.js');
  if (!existsSync(parserPath)) {
    console.error(
      `Compiled parser not found at ${parserPath}\nRun \`npm run build\` first — this tool reuses the CX2 parser so that\nattributeDeclarations aliases and defaults are resolved exactly as in conversion.`
    );
    process.exit(1);
  }
  const { parseCX2 } = await import(parserPath);

  const files = [];
  for (const target of opts.targets) {
    files.push(...(await collectCx2Files(target)));
  }
  if (files.length === 0) {
    console.error('No .cx2 files found in: ' + opts.targets.join(', '));
    process.exit(1);
  }

  console.error(`Scanning ${files.length} CX2 file(s)…`);
  const { byIdentifier, scanned } = await collectChemicalNodes(
    files,
    opts.types,
    parseCX2
  );
  const entries = [...byIdentifier.values()];
  const instances = entries.reduce((n, e) => n + e.count, 0);
  console.error(
    `  ${entries.length} distinct identifier(s) across ${instances} node instance(s) in ${scanned} file(s)`
  );

  await mkdir(opts.out, { recursive: true });
  const snapshotPath = join(opts.out, 'snapshot.json');

  let normalizedById = {};
  if (opts.offline) {
    if (!existsSync(snapshotPath)) {
      throw new Error(`--offline given but no snapshot at ${snapshotPath}`);
    }
    const prev = JSON.parse(await readFile(snapshotPath, 'utf-8'));
    normalizedById = prev.normalizer ?? {};
    console.error('  --offline: reusing existing snapshot, no network calls');
  } else {
    const curies = entries.map((e) => toNormalizerCurie(e.identifier)).filter(Boolean);
    for (let i = 0; i < curies.length; i += opts.batch) {
      const batch = curies.slice(i, i + opts.batch);
      console.error(
        `  normalizing ${i + 1}–${i + batch.length} of ${curies.length}…`
      );
      Object.assign(normalizedById, await normalizeBatch(batch));
    }
  }

  const rows = flagCollisions(
    entries.map((e) => resolve1(e, normalizedById[toNormalizerCurie(e.identifier) ?? '']))
  ).sort(
    (a, b) =>
      FLAG_ORDER.indexOf(a.flag) - FLAG_ORDER.indexOf(b.flag) ||
      a.name.localeCompare(b.name)
  );

  const meta = {
    generated: new Date().toISOString().slice(0, 10),
    scanned,
    types: [...opts.types].join(','),
    instances,
  };

  await writeFile(
    snapshotPath,
    JSON.stringify(
      {
        generated: meta.generated,
        source: NODE_NORM_URL,
        policy: 'PubChem CID > ChEBI > source identifier; full clique kept for skos:exactMatch',
        types: [...opts.types],
        mapping: Object.fromEntries(
          rows.map((r) => [
            r.source,
            {
              flag: r.flag,
              chosen: r.chosen,
              chosenIri: r.chosenIri,
              pubchem: r.pubchem || undefined,
              chebi: r.chebi || undefined,
              label: r.normalizedLabel || undefined,
              collidesWith: r.collidesWith?.length ? r.collidesWith : undefined,
              overrideReason: r.overrideReason,
              exactMatch: r.exactMatch,
            },
          ])
        ),
        normalizer: normalizedById,
      },
      null,
      2
    ) + '\n',
    'utf-8'
  );
  await writeFile(join(opts.out, 'review.tsv'), renderTsv(rows), 'utf-8');
  await writeFile(join(opts.out, 'review.md'), renderMarkdown(rows, meta), 'utf-8');
  await writeFile(join(PKG_ROOT, 'src', 'core', 'chemical-normalization.ts'), renderTsModule(rows, meta), 'utf-8');

  const counts = {};
  for (const r of rows) counts[r.flag] = (counts[r.flag] ?? 0) + 1;
  console.error('Flags: ' + FLAG_ORDER.filter((f) => counts[f]).map((f) => `${f}=${counts[f]}`).join('  '));
  console.error(`Wrote snapshot.json, review.tsv, review.md to ${opts.out}`);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
