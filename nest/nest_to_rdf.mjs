#!/usr/bin/env node
/**
 * nest_to_rdf.mjs
 *
 * Convert the NeST hierarchy + its linked IAS interaction network from NDEx into a single
 * Turtle file, per NEST_HIERARCHY_DATASET.md and IAS_NETWORK_GENERATION.md.
 *
 *   node nest_to_rdf.mjs 4f9210a1-8797-11f1-857e-005056ae3c32 -o nest.ttl
 *
 * Takes one required argument: the NDEx UUID of the NeST hierarchy (an HCX network). The
 * UUID of the interaction network is read from that network's own
 * `HCX::interactionNetworkUUID` attribute and downloaded automatically. Both downloads are
 * cached (the IAS network is ~54 MB), so re-runs are offline.
 *
 * This is a port of `nest_to_rdf.py` and is intended to be byte-for-byte equivalent to it;
 * `diff` of the two outputs is the regression test. See that file for the full description
 * of what is emitted and why.
 *
 * Options:
 *   -o, --out <path>        output Turtle file (default: nest.ttl)
 *   --cutoff <n>            systems with Size >= n emit no membership or associations (400)
 *   --mondo <path>          cohort -> MONDO mapping (default: ./cancer_type_mondo_map.tsv)
 *   --cache-dir <dir>       where downloaded CX2 files are cached (default: ./.ndex-cache)
 *   --ndex <url>            NDEx server base URL (default: https://www.ndexbio.org)
 *   --offline               fail instead of downloading if a network is not cached
 *   --dataset-version <s>   pav:version recorded on the dataset node (default: 1.0)
 *
 * NOTE: parsing the ~54 MB IAS network needs a large heap. If node reports a heap OOM,
 * re-run with `node --max-old-space-size=4096 nest_to_rdf.mjs ...`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL_VERSION = 'nest_to_rdf 1.0';
const NDEX_DEFAULT = 'https://www.ndexbio.org';
const DOI = 'https://doi.org/10.1126/science.abf3067';

const PREFIXES = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  owl: 'http://www.w3.org/2002/07/owl#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  dcterms: 'http://purl.org/dc/terms/',
  void: 'http://rdfs.org/ns/void#',
  prov: 'http://www.w3.org/ns/prov#',
  pav: 'http://purl.org/pav/',
  biolink: 'https://w3id.org/biolink/vocab/',
  MONDO: 'http://purl.obolibrary.org/obo/MONDO_',
  ECO: 'http://purl.obolibrary.org/obo/ECO_',
  NCIT: 'http://purl.obolibrary.org/obo/NCIT_',
  OBI: 'http://purl.obolibrary.org/obo/OBI_',
  STATO: 'http://purl.obolibrary.org/obo/STATO_',
  SIO: 'http://semanticscience.org/resource/SIO_',
  uniprot: 'http://purl.uniprot.org/uniprot/',
  hgnc: 'http://identifiers.org/hgnc/',
  ndexv: 'https://www.ndexbio.org/vocab/',
  nestv: 'https://www.ndexbio.org/vocab/nest/',
  iasv: 'https://www.ndexbio.org/vocab/ias/',
  nest: 'https://www.ndexbio.org/identifiers/',
  ndex: 'https://www.ndexbio.org/viewer/networks/',
};

// CX2 node `type` -> RDF class. SIO rather than biolink:Protein so a merged store types the
// same uniprot: IRI consistently with the NCI-PID graph (IAS spec Section 5).
const NODE_CLASS = { protein: 'SIO:010043', gene: 'SIO:010035' };

const CANCER = 'MONDO:0004992'; // pan-cancer association object
const EVIDENCE = 'ECO:0007672'; // computational evidence
const BH = 'NCIT:C61596'; // Benjamini-Hochberg Procedure

// ------------------------------------------------------------------ NDEx + CX2

async function fetchCx2(base, uuid, cacheDir, offline) {
  const file = path.join(cacheDir, `${uuid}.cx2`);
  if (fs.existsSync(file)) {
    console.error(`  cached  ${uuid}  (${fs.statSync(file).size.toLocaleString('en-US')} bytes)`);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  if (offline) die(`--offline but ${file} is not cached`);
  const url = `${base}/v3/networks/${uuid}`;
  console.error(`  GET     ${url}`);
  let raw;
  try {
    const resp = await fetch(url);
    if (!resp.ok) die(`could not download ${uuid}: HTTP ${resp.status}`);
    raw = Buffer.from(await resp.arrayBuffer());
  } catch (err) {
    die(`could not download ${uuid}: ${err.message}`);
  }
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(file, raw);
  console.error(`          ${raw.length.toLocaleString('en-US')} bytes -> ${file}`);
  return JSON.parse(raw.toString('utf8'));
}

/** CX2 is an array of single-key aspect objects. */
function aspects(cx2) {
  const out = {};
  for (const a of cx2) {
    if (a && typeof a === 'object' && Object.keys(a).length === 1) {
      const k = Object.keys(a)[0];
      out[k] = a[k];
    }
  }
  return out;
}

/** CX2 attributeDeclarations may abbreviate names (`name` stored as `n`). Map back. */
function aliasMap(decls, kind) {
  const out = {};
  for (const [full, spec] of Object.entries(decls[kind] || {})) {
    if (spec && typeof spec === 'object' && 'a' in spec) out[spec.a] = full;
  }
  return out;
}

function attrs(element, aliases) {
  const out = {};
  for (const [k, v] of Object.entries(element.v)) out[aliases[k] ?? k] = v;
  return out;
}

// ---------------------------------------------------------------------- Turtle

/** Escape a Turtle string literal. */
const esc = (t) =>
  String(t).replaceAll('\\', '\\\\').replaceAll('"', '\\"')
    .replaceAll('\n', '\\n').replaceAll('\r', '\\r').replaceAll('\t', '\\t');

/**
 * Format a float exactly as Python's `repr` would.
 *
 * Needed only so this script's output stays byte-identical to nest_to_rdf.py's, which is
 * how the two implementations are checked against each other. The forms diverge otherwise:
 * Python switches to exponential notation below 1e-4, JavaScript not until 1e-7, so
 * 4.887e-05 would print as "0.00004887..." here and "4.887e-05" there. Python also pads
 * the exponent to two digits.
 */
function pyRepr(x) {
  const n = Number(x);
  if (Number.isInteger(n) && Math.abs(n) < 1e16) return n.toFixed(1);
  const a = Math.abs(n);
  if (a !== 0 && (a < 1e-4 || a >= 1e16)) {
    return n.toExponential().replace(/e([+-])(\d)$/, 'e$10$2');
  }
  return String(n);
}

/**
 * A typed xsd:double literal.
 *
 * Turtle's bare number syntax infers the datatype from the lexical form: `1` is xsd:integer
 * and `0.65` is xsd:decimal, neither of which matches the xsd:double range the vocabulary
 * declares. So always write the datatype explicitly.
 */
const dbl = (v) => `"${pyRepr(v)}"^^xsd:double`;

/** A typed xsd:nonNegativeInteger literal, matching ndexv:memberCount's declared range. */
const nonneg = (v) => `"${Math.trunc(Number(v))}"^^xsd:nonNegativeInteger`;

/** Buffered writer — the output is ~57 MB, so it is flushed in chunks rather than joined. */
class Writer {
  constructor(fd) {
    this.fd = fd;
    this.buf = [];
    this.bytes = 0;
    this.count = 0;
  }
  #push(s) {
    this.buf.push(s);
    this.bytes += s.length;
    if (this.bytes > 4 << 20) this.flush();
  }
  flush() {
    if (this.buf.length) fs.writeSync(this.fd, this.buf.join(''));
    this.buf = [];
    this.bytes = 0;
  }
  raw(text = '') {
    this.#push(text + '\n');
  }
  triple(s, p, o) {
    this.#push(`${s} ${p} ${o} .\n`);
    this.count += 1;
  }
  /**
   * pairs: [predicate, object] or [predicate, object, comment].
   * A comment is emitted AFTER the `;`/`.` terminator — putting it before would make the
   * terminator part of the comment and produce invalid Turtle.
   */
  block(subject, pairs) {
    if (!pairs.length) return;
    this.#push(subject + '\n');
    pairs.forEach(([p, o, comment], i) => {
      const end = i === pairs.length - 1 ? ' .' : ' ;';
      const tail = comment ? `   # ${comment}` : '';
      this.#push(`    ${p} ${o}${end}${tail}\n`);
      this.count += 1;
    });
    this.#push('\n');
  }
}

// ------------------------------------------------------------------- sections

// Local date, matching Python's datetime.date.today(). Using toISOString() here would
// give the UTC date and the two implementations would disagree across midnight.
const today = () => {
  const d = new Date();
  const p2 = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
};

function writeHeader(w, hierUuid, iasUuid) {
  for (const [prefix, iri] of Object.entries(PREFIXES)) w.raw(`@prefix ${prefix}: <${iri}> .`);
  w.raw();
  w.raw('# ' + '='.repeat(76));
  w.raw('# NeST cancer systems map + IAS protein-association network');
  w.raw(`# Generated by ${TOOL_VERSION} on ${today()}`);
  w.raw(`#   hierarchy  NDEx ${hierUuid}`);
  w.raw(`#   IAS        NDEx ${iasUuid}`);
  w.raw('#');
  w.raw('# READ BEFORE QUERYING');
  w.raw('#  1. biolink:interacts_with is SYMMETRIC, but only ONE direction is written per');
  w.raw('#     edge. A query that does not perform OWL reasoning must match both, e.g.');
  w.raw('#       { ?a biolink:interacts_with ?b } UNION { ?b biolink:interacts_with ?a }');
  w.raw('#     or  ?a ^biolink:interacts_with|biolink:interacts_with ?b');
  w.raw('#  2. Minted statement IRIs (nest:e<n>) are BUILD-SCOPED and change whenever the');
  w.raw('#     source network is refiltered. A new build REPLACES this graph; never merge');
  w.raw('#     it into an existing load. See pav:version on the dataset node.');
  w.raw('# ' + '='.repeat(76));
  w.raw();
}

function writeVocabulary(w) {
  w.raw('# ---- minted vocabulary ------------------------------------------------');
  w.block('ndexv:ProteinSystem a rdfs:Class, owl:Class ;', [
    ['rdfs:label', '"protein system"'],
    ['rdfs:comment', '"A set of proteins identified as functioning together, derived by ' +
      'multiscale community detection over a protein-association network. Spans scales ' +
      'from protein complexes to broad cellular processes."'],
    ['rdfs:subClassOf', 'biolink:BiologicalEntity'],
  ]);
  w.block('ndexv:memberCount a rdf:Property, owl:DatatypeProperty ;', [
    ['rdfs:label', '"member count"'],
    ['rdfs:comment', '"Number of distinct member proteins in the system as reported by the ' +
      'source. NOT necessarily the number of emitted biolink:has_member triples: ' +
      'membership is suppressed above the size cutoff, and a few members have no node in ' +
      'the interaction network."'],
    ['rdfs:subPropertyOf', 'biolink:has_count'],
    ['rdfs:domain', 'ndexv:ProteinSystem'],
    ['rdfs:range', 'xsd:nonNegativeInteger'],
  ]);
  w.block('nestv:tumorsMutatedFraction a rdf:Property, owl:DatatypeProperty ;', [
    ['rdfs:label', '"tumors mutated fraction"'],
    ['rdfs:comment', '"Fraction of tumors in the cohort carrying at least one somatic ' +
      'mutation in any member gene of the system. Numerator: patients with >=1 mutated ' +
      'member. Denominator: patients in the cohort."'],
    ['rdfs:subPropertyOf', 'biolink:has_quotient'],
    ['rdfs:domain', 'biolink:Association'],
    ['rdfs:range', 'xsd:double'],
  ]);
  w.block('nestv:hisigWeight a rdf:Property, owl:DatatypeProperty ;', [
    ['rdfs:label', '"HiSig weight"'],
    ['rdfs:comment', '"Lasso coefficient assigned to the system by HiSig - how much of the ' +
      'observed mutational signal the model attributes to it. One value per system, from ' +
      'the pan-cancer run. NOT a significance measure: read it together with ' +
      'nestv:hisigAdjustedPValue, emitted on the same node for every system."'],
    ['rdfs:seeAlso', 'STATO:0000565'],
    ['rdfs:domain', 'ndexv:ProteinSystem'],
    ['rdfs:range', 'xsd:double'],
  ]);
  w.block('nestv:hisigAdjustedPValue a rdf:Property, owl:DatatypeProperty ;', [
    ['rdfs:label', '"HiSig adjusted p-value"'],
    ['rdfs:comment', '"Benjamini-Hochberg-corrected empirical p-value from HiSig\'s ' +
      'permutation test, pan-cancer. One value per system, emitted for all systems; many ' +
      'are exactly 1.0, i.e. not significant."'],
    ['rdfs:seeAlso', 'OBI:0000175'],
    ['rdfs:seeAlso', BH],
    ['rdfs:domain', 'ndexv:ProteinSystem'],
    ['rdfs:range', 'xsd:double'],
  ]);
  w.block('iasv:integratedAssociationStringency a rdf:Property, owl:DatatypeProperty ;', [
    ['rdfs:label', '"integrated association stringency"'],
    ['rdfs:comment', '"The IAS score: a granularity/stringency measure of shared-system ' +
      'membership, trained to predict GO semantic similarity. NOT a probability, p-value, ' +
      'or binding score."'],
    ['rdfs:domain', 'rdf:Statement'],
    ['rdfs:range', 'xsd:double'],
  ]);
  w.block('iasv:retainedForConnectivity a rdf:Property, owl:DatatypeProperty ;', [
    ['rdfs:label', '"retained for connectivity"'],
    ['rdfs:comment', '"True on an edge kept only because it is one of its proteins\' single ' +
      'highest-scoring edge, i.e. below the IAS core threshold. Emitted only where true."'],
    ['rdfs:domain', 'rdf:Statement'],
    ['rdfs:range', 'xsd:boolean'],
  ]);
}

function writeProvenance(w, hierUuid, iasUuid, version) {
  w.raw('# ---- provenance -------------------------------------------------------');
  w.block('nest:nest-kg a void:Dataset, prov:Entity ;', [
    ['dcterms:title', '"NeST cancer systems map with IAS protein-association network"'],
    ['dcterms:description', '"NeST 1.0 hierarchy of protein systems under mutational ' +
      'selection across 13 cancer types, with the filtered IAS protein-association network ' +
      'its members are drawn from."'],
    ['dcterms:publisher', '<https://www.ndexbio.org>'],
    ['dcterms:source', `<${DOI}>`],
    ['dcterms:created', `"${today()}"^^xsd:date`],
    ['pav:version', `"${esc(version)}"`],
    ['prov:wasDerivedFrom', `ndex:${hierUuid}`],
    ['prov:wasDerivedFrom', `ndex:${iasUuid}`],
    ['prov:wasGeneratedBy', '[ a prov:Activity ; prov:wasAssociatedWith ' +
      `<https://github.com/ndexbio/proto-okn> ; pav:version "${TOOL_VERSION}" ]`],
  ]);
}

function writeHierarchy(w, hier, cutoff, stats) {
  const A = aspects(hier);
  const na = aliasMap(A.attributeDeclarations[0], 'nodes');
  const nodes = A.nodes.map((n) => [n.id, attrs(n, na)]);
  const byId = new Map(nodes);
  const local = (v) => 'nest:' + v['NEST ID'].replaceAll(':', '-');

  w.raw('# ---- system nodes -----------------------------------------------------');
  for (const [, v] of nodes) {
    const pairs = [
      ['a', 'ndexv:ProteinSystem'],
      ['rdfs:label', `"${esc(v.Annotation)}"`],
      ['dcterms:identifier', `"${esc(v['NEST ID'])}"`],
      ['ndexv:memberCount', nonneg(v.Size)],
    ];
    if (v.Weight) pairs.push(['nestv:hisigWeight', dbl(v.Weight)]); // skipped when 0 (root)
    const pval = v['adjusted  p-value']; // NOTE: two spaces in the source attribute name
    if (pval !== undefined && pval !== null) pairs.push(['nestv:hisigAdjustedPValue', dbl(pval)]);
    w.block(local(v) + ' ', pairs);
    stats.systems += 1;
  }

  w.raw('# ---- containment: child part_of parent --------------------------------');
  for (const e of A.edges) {
    // edges run parent(s) -> child(t)
    w.triple(local(byId.get(e.t)), 'biolink:part_of', local(byId.get(e.s)));
    stats.part_of += 1;
  }
  w.raw();

  const small = nodes.filter(([, v]) => Number(v.Size) < cutoff);
  stats.suppressed = nodes.length - small.length;
  return { small, local };
}

function writeMembership(w, small, iasIri, local, stats) {
  for (const [, v] of small) {
    const iris = (v['HCX::members'] || []).map((m) => iasIri.get(m)).filter(Boolean);
    if (!iris.length) continue;
    w.raw(`${local(v)} biolink:has_member ` + iris.join(',\n        ') + ' .');
    stats.member_emitted += iris.length;
  }
  w.raw();
}

function writeAssociations(w, small, mondo, local, stats) {
  w.raw('# ---- associations: per significantly-mutated cancer type --------------');
  for (const [, v] of small) {
    const codes = (v['Significantly mutated cancer types'] || '').split(/\s+/).filter(Boolean);
    const sid = v['NEST ID'].replaceAll(':', '-');
    for (const code of [...codes].sort()) {
      if (!mondo.has(code)) {
        console.error(`  WARNING: ${v['NEST ID']} cohort '${code}' not in the MONDO map`);
        continue;
      }
      const [term, label] = mondo.get(code);
      const freq = v[`Mutation frequency:${code}`];
      const pairs = [
        ['a', 'biolink:Association'],
        ['biolink:subject', local(v)],
        ['biolink:predicate', 'biolink:genetically_associated_with'],
        ['biolink:object', term, label],
      ];
      if (freq !== undefined && freq !== null) {
        pairs.push(['nestv:tumorsMutatedFraction', dbl(freq)]);
      }
      pairs.push(
        ['biolink:knowledge_level', 'biolink:statistical_association'],
        ['biolink:agent_type', 'biolink:data_analysis_pipeline'],
        ['biolink:has_evidence', EVIDENCE],
      );
      w.block(`nest:${sid}-${code} `, pairs);
      stats.assoc_cohort += 1;
    }
  }

  w.raw('# ---- associations: pan-cancer HiSig selection (adj p < 0.05) ----------');
  for (const [, v] of small) {
    const pval = v['adjusted  p-value'];
    if (pval === undefined || pval === null || pval >= 0.05) continue;
    const sid = v['NEST ID'].replaceAll(':', '-');
    w.block(`nest:${sid}-hisig `, [
      ['a', 'biolink:Association'],
      ['biolink:subject', local(v)],
      ['biolink:predicate', 'biolink:genetically_associated_with'],
      ['biolink:object', CANCER, 'cancer'],
      ['biolink:knowledge_level', 'biolink:statistical_association'],
      ['biolink:agent_type', 'biolink:data_analysis_pipeline'],
      ['biolink:has_evidence', EVIDENCE],
    ]);
    stats.assoc_pan += 1;
  }
}

function writeIas(w, ias, stats) {
  const A = aspects(ias);
  const decls = A.attributeDeclarations[0];
  const na = aliasMap(decls, 'nodes');
  const ea = aliasMap(decls, 'edges');
  const context = JSON.parse(A.networkAttributes[0]['@context'] || '{}');

  const curieToTerm = (curie) => {
    if (!curie || !curie.includes(':')) return null;
    const i = curie.indexOf(':');
    const [prefix, localName] = [curie.slice(0, i), curie.slice(i + 1)];
    if (prefix in PREFIXES) return `${prefix}:${localName}`;
    const base = context[prefix];
    return base ? `<${base}${localName}>` : null;
  };

  w.raw('# ---- IAS protein nodes ------------------------------------------------');
  const iasIri = new Map();
  for (const n of A.nodes) {
    const v = attrs(n, na);
    const term = curieToTerm(v.represents || '');
    if (term === null) {
      console.error(`  WARNING: IAS node ${n.id} has unresolvable represents ` +
        `'${v.represents}'; skipped`);
      continue;
    }
    iasIri.set(n.id, term);
    const cls = NODE_CLASS[(v.type || '').toLowerCase()] ?? NODE_CLASS.protein;
    w.triple(term, 'a', cls);
    w.triple(term, 'rdfs:label', `"${esc(v.name)}"`);
    stats.proteins += 1;
  }
  w.raw();

  // Nodes are keyed on gene symbol in the CX2, but RDF IRIs come from `represents` (a
  // UniProt accession), and 35 accessions are shared by 96 symbols (histone clusters,
  // tandem paralogs). An edge between two symbols sharing an accession therefore collapses
  // to a self-loop, which would assert that a protein interacts with itself. Drop those,
  // matching the NCI-PID adapter's behaviour.
  const endpoints = (e) => {
    const s = iasIri.get(e.s);
    const t = iasIri.get(e.t);
    if (s === undefined || t === undefined) return null;
    if (s === t) return 'selfloop';
    return [s, t];
  };

  w.raw('# ---- IAS interactions: ONE triple per edge (symmetry not materialized) -');
  for (const e of A.edges) {
    const ends = endpoints(e);
    if (ends === null) continue;
    if (ends === 'selfloop') { stats.selfloops += 1; continue; }
    w.triple(ends[0], 'biolink:interacts_with', ends[1]);
    stats.interactions += 1;
  }
  w.raw();

  w.raw('# ---- IAS per-edge score -----------------------------------------------');
  for (const e of A.edges) {
    const ends = endpoints(e);
    if (ends === null || ends === 'selfloop') continue;
    const [s, t] = ends;
    const v = attrs(e, ea);
    const pairs = [
      ['a', 'rdf:Statement'],
      ['rdf:subject', s],
      ['rdf:predicate', 'biolink:interacts_with'],
      ['rdf:object', t],
    ];
    if (v.integrated_score !== undefined && v.integrated_score !== null) {
      pairs.push(['iasv:integratedAssociationStringency', dbl(v.integrated_score)]);
    }
    if (v.edge_role === 'backbone') {
      pairs.push(['iasv:retainedForConnectivity', '"true"^^xsd:boolean']);
      stats.backbone += 1;
    }
    w.block(`nest:e${e.id} `, pairs);
    stats.statements += 1;
  }
  return iasIri;
}

// ------------------------------------------------------------------------ main

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function loadMondo(file) {
  const out = new Map();
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const header = lines[0].split('\t');
  const ix = (name) => header.indexOf(name);
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const f = line.split('\t');
    if (f[ix('mondo_id')]) out.set(f[ix('code')], [f[ix('mondo_id')], f[ix('mondo_label')]]);
  }
  return out;
}

function parseArgs(argv) {
  const opts = {
    out: 'nest.ttl',
    cutoff: 400,
    mondo: path.join(HERE, 'cancer_type_mondo_map.tsv'),
    cacheDir: path.join(HERE, '.ndex-cache'),
    ndex: NDEX_DEFAULT,
    offline: false,
    datasetVersion: '1.0',
    uuid: null,
  };
  const flags = {
    '-o': 'out', '--out': 'out', '--cutoff': 'cutoff', '--mondo': 'mondo',
    '--cache-dir': 'cacheDir', '--ndex': 'ndex', '--dataset-version': 'datasetVersion',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--offline') { opts.offline = true; continue; }
    if (a === '-h' || a === '--help') {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')
        .split('*/')[0].replace(/^#!.*\n/, ''));
      process.exit(0);
    }
    if (a in flags) { opts[flags[a]] = argv[++i]; continue; }
    if (a.startsWith('-')) die(`unknown option ${a}`);
    if (opts.uuid) die('expected exactly one UUID argument');
    opts.uuid = a;
  }
  if (!opts.uuid) die('missing required argument: the NDEx UUID of the NeST hierarchy');
  opts.cutoff = Number(opts.cutoff);
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  console.error('resolving networks');
  const hier = await fetchCx2(opts.ndex, opts.uuid, opts.cacheDir, opts.offline);
  const hna = aspects(hier).networkAttributes[0];
  if (hna.ndexSchema !== 'hierarchy_v0.1') {
    console.error(`  WARNING: ndexSchema is '${hna.ndexSchema}', expected 'hierarchy_v0.1' ` +
      '— is this an HCX hierarchy?');
  }
  const iasUuid = hna['HCX::interactionNetworkUUID'];
  if (!iasUuid) {
    die('the hierarchy has no HCX::interactionNetworkUUID attribute, so the interaction ' +
      'network cannot be located.');
  }
  console.error(`  interaction network: ${iasUuid}`);
  const ias = await fetchCx2(opts.ndex, iasUuid, opts.cacheDir, opts.offline);

  const mondo = loadMondo(opts.mondo);
  console.error(`  cohort -> MONDO entries: ${mondo.size}`);

  const stats = {
    systems: 0, part_of: 0, has_member: 0, member_emitted: 0, assoc_cohort: 0,
    assoc_pan: 0, proteins: 0, interactions: 0, statements: 0, backbone: 0,
    suppressed: 0, selfloops: 0,
  };

  console.error(`writing ${opts.out}`);
  const fd = fs.openSync(opts.out, 'w');
  const w = new Writer(fd);
  writeHeader(w, opts.uuid, iasUuid);
  writeVocabulary(w);
  writeProvenance(w, opts.uuid, iasUuid, opts.datasetVersion);
  const { small, local } = writeHierarchy(w, hier, opts.cutoff, stats);
  const iasIri = writeIas(w, ias, stats);
  // membership needs the IAS node -> IRI table, so it is written after the IAS nodes
  w.raw(`# ---- membership (systems with Size < ${opts.cutoff}) ------------------`);
  writeMembership(w, small, iasIri, local, stats);
  writeAssociations(w, small, mondo, local, stats);
  w.flush();
  fs.closeSync(fd);

  const n = (x) => x.toLocaleString('en-US').padStart(9);
  console.error('\ndone');
  console.error(`  systems .................. ${n(stats.systems)} ` +
    `(${stats.suppressed} above the cutoff emit no payload)`);
  console.error(`  part_of .................. ${n(stats.part_of)}`);
  console.error(`  has_member ............... ${n(stats.member_emitted)}`);
  console.error(`  associations (per-cohort)  ${n(stats.assoc_cohort)}`);
  console.error(`  associations (pan-cancer)  ${n(stats.assoc_pan)}`);
  console.error(`  protein nodes ............ ${n(stats.proteins)}`);
  console.error(`  interactions ............. ${n(stats.interactions)}`);
  console.error(`  edge statements .......... ${n(stats.statements)} ` +
    `(${stats.backbone.toLocaleString('en-US')} backbone)`);
  if (stats.selfloops) {
    console.error(`  self-loops dropped ....... ${n(stats.selfloops)} ` +
      '(symbols sharing a UniProt accession)');
  }
  console.error(`  TOTAL TRIPLES ............ ${n(w.count)}`);
  console.error(`  -> ${opts.out} (${fs.statSync(opts.out).size.toLocaleString('en-US')} bytes)`);
}

main();
