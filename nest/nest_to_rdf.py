#!/usr/bin/env python3
"""
Convert the NeST hierarchy + its linked IAS interaction network from NDEx into a single
Turtle file, per NEST_HIERARCHY_DATASET.md and IAS_NETWORK_GENERATION.md.

    python3 nest_to_rdf.py 4f9210a1-8797-11f1-857e-005056ae3c32 -o nest.ttl

Takes one required argument: the NDEx UUID of the NeST hierarchy (an HCX network). The
UUID of the interaction network is read from that network's own
`HCX::interactionNetworkUUID` attribute and downloaded automatically. Both downloads are
cached (the IAS network is ~62 MB), so re-runs are offline.

WHAT IS EMITTED (see the design docs for the reasoning behind each choice)

  hierarchy                                                        ~19,700 triples
    every system node       ndexv:ProteinSystem, rdfs:label (Annotation),
                            dcterms:identifier, ndexv:memberCount,
                            nestv:hisigWeight (skipped when 0), nestv:hisigAdjustedPValue
    containment             child biolink:part_of parent, all edges, unreified
    membership              biolink:has_member, ONLY for systems below --cutoff
    associations            per-cohort (one per significantly-mutated cancer type, carrying
                            nestv:tumorsMutatedFraction) + pan-cancer (where adj p < 0.05),
                            ONLY for systems below --cutoff

  IAS network                                                   ~1,298,900 triples
    protein nodes           SIO:010043 (protein) / SIO:010035 (gene) + rdfs:label
    interactions            one biolink:interacts_with triple per edge, source order only
    per-edge score          rdf:Statement `nest:e<cx2EdgeId>` carrying
                            iasv:integratedAssociationStringency, plus
                            iasv:retainedForConnectivity on backbone edges

  provenance                one void:Dataset node citing both NDEx deposits and the DOI

TWO THINGS CONSUMERS MUST KNOW, both documented in the output header:
  * biolink:interacts_with is symmetric but only ONE direction is written. Queries that do
    not reason must match both directions.
  * Statement IRIs are build-scoped. A new build REPLACES the graph; never merge.
"""
import argparse
import csv
import re
import datetime
import json
import os
import sys
import urllib.error
import urllib.request

TOOL_VERSION = "nest_to_rdf 1.0"
NDEX_DEFAULT = "https://www.ndexbio.org"
DOI = "https://doi.org/10.1126/science.abf3067"

PREFIXES = {
    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
    "owl": "http://www.w3.org/2002/07/owl#",
    "xsd": "http://www.w3.org/2001/XMLSchema#",
    "dcterms": "http://purl.org/dc/terms/",
    "void": "http://rdfs.org/ns/void#",
    "prov": "http://www.w3.org/ns/prov#",
    "pav": "http://purl.org/pav/",
    "biolink": "https://w3id.org/biolink/vocab/",
    "MONDO": "http://purl.obolibrary.org/obo/MONDO_",
    "ECO": "http://purl.obolibrary.org/obo/ECO_",
    "NCIT": "http://purl.obolibrary.org/obo/NCIT_",
    "OBI": "http://purl.obolibrary.org/obo/OBI_",
    "STATO": "http://purl.obolibrary.org/obo/STATO_",
    "SIO": "http://semanticscience.org/resource/SIO_",
    "uniprot": "http://purl.uniprot.org/uniprot/",
    "hgnc": "http://identifiers.org/hgnc/",
    "ndexv": "https://www.ndexbio.org/vocab/",
    "nestv": "https://www.ndexbio.org/vocab/nest/",
    "iasv": "https://www.ndexbio.org/vocab/ias/",
    "nest": "https://www.ndexbio.org/identifiers/",
    "ndex": "https://www.ndexbio.org/viewer/networks/",
}

# CX2 node `type` -> RDF class. SIO rather than biolink:Protein so a merged store types the
# same uniprot: IRI consistently with the NCI-PID graph (IAS spec Section 5).
NODE_CLASS = {"protein": "SIO:010043", "gene": "SIO:010035"}

CANCER = "MONDO:0004992"          # pan-cancer association object
EVIDENCE = "ECO:0007672"          # computational evidence
BH = "NCIT:C61596"                # Benjamini-Hochberg Procedure


# ------------------------------------------------------------------ NDEx + CX2

def fetch_cx2(base, uuid, cache_dir, offline=False, idle_timeout=300):
    """
    Download a CX2 network by UUID, caching it. Unlisted networks resolve by UUID.

    `idle_timeout` is passed to urlopen, where it is a per-socket-operation timeout: it
    bounds connect and each individual read, NOT the total transfer. A slow but progressing
    download of a 50 MB network is therefore never cut off — only a genuine stall fails.
    """
    path = os.path.join(cache_dir, f"{uuid}.cx2")
    if os.path.exists(path):
        print(f"  cached  {uuid}  ({os.path.getsize(path):,} bytes)", file=sys.stderr)
        with open(path) as fh:
            return json.load(fh)
    if offline:
        sys.exit(f"ERROR: --offline but {path} is not cached")
    url = f"{base}/v3/networks/{uuid}"
    print(f"  GET     {url}", file=sys.stderr, flush=True)
    try:
        with urllib.request.urlopen(url, timeout=idle_timeout) as resp:
            raw = resp.read()
    except (urllib.error.URLError, TimeoutError) as exc:
        sys.exit(f"ERROR: could not download {uuid}: {exc}")
    os.makedirs(cache_dir, exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(raw)
    print(f"          {len(raw):,} bytes -> {path}", file=sys.stderr)
    return json.loads(raw)


def aspects(cx2):
    return {next(iter(a)): a[next(iter(a))]
            for a in cx2 if isinstance(a, dict) and len(a) == 1}


def alias_map(decls, kind):
    """CX2 attributeDeclarations may abbreviate names (`name` stored as `n`). Map back."""
    out = {}
    for full, spec in (decls.get(kind) or {}).items():
        if isinstance(spec, dict) and "a" in spec:
            out[spec["a"]] = full
    return out


def attrs(element, aliases):
    return {aliases.get(k, k): v for k, v in element["v"].items()}


# ---------------------------------------------------------------------- Turtle

def esc(text):
    """Escape a Turtle string literal."""
    return (str(text).replace("\\", "\\\\").replace('"', '\\"')
            .replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t"))


def curie_to_term(curie, context):
    """`uniprot:P02452` -> a Turtle term, using the network @context for unknown prefixes."""
    if ":" not in curie:
        return None
    prefix, local = curie.split(":", 1)
    if prefix in PREFIXES:
        return f"{prefix}:{local}"
    base = context.get(prefix)
    return f"<{base}{local}>" if base else None


def dbl(value):
    """
    A typed xsd:double literal.

    Turtle's bare number syntax infers the datatype from the lexical form: `1` is
    xsd:integer and `0.65` is xsd:decimal, neither of which matches the xsd:double range
    the vocabulary declares. A p-value that the source happens to store as `1` would
    otherwise be typed xsd:integer. So always write the datatype explicitly.
    """
    return f'"{float(value)!r}"^^xsd:double'


def nonneg(value):
    """A typed xsd:nonNegativeInteger literal, matching ndexv:memberCount's declared range."""
    return f'"{int(value)}"^^xsd:nonNegativeInteger'


def head_triples(subject):
    """
    Triples carried on a block's *subject line* rather than in its indented pairs.

    `ndexv:memberCount a rdf:Property, owl:DatatypeProperty ;` states two rdf:type triples
    before the first pair is written. Counting only the pairs would miss them.
    """
    m = re.search(r"\sa\s+([^;]+);\s*$", subject)
    return len(m.group(1).split(",")) if m else 0


class Writer:
    def __init__(self, fh):
        self.fh = fh
        self.count = 0

    def raw(self, text=""):
        """Text that carries no triples (comments, blank lines, section headers)."""
        self.fh.write(text + "\n")

    def raw_triples(self, text, n):
        """Text carrying `n` triples — e.g. one subject with a comma-separated object list."""
        self.fh.write(text + "\n")
        self.count += n

    def triple(self, s, p, o):
        self.fh.write(f"{s} {p} {o} .\n")
        self.count += 1

    def block(self, subject, pairs):
        """
        pairs: (predicate, object), (predicate, object, comment), or
               (predicate, object, comment, n_triples).

        A comment is emitted AFTER the `;`/`.` terminator — putting it before would make the
        terminator part of the comment and produce invalid Turtle.

        `n_triples` defaults to 1 and exists for object slots that are not a single triple,
        such as an inlined blank node: `[ a prov:Activity ; prov:wasAssociatedWith <x> ; … ]`
        is the link plus everything inside it.
        """
        if not pairs:
            return
        self.fh.write(subject + "\n")
        self.count += head_triples(subject)
        for i, item in enumerate(pairs):
            p, o = item[0], item[1]
            comment = item[2] if len(item) > 2 else None
            n = item[3] if len(item) > 3 else 1
            end = " ." if i == len(pairs) - 1 else " ;"
            tail = f"   # {comment}" if comment else ""
            self.fh.write(f"    {p} {o}{end}{tail}\n")
            self.count += n
        self.fh.write("\n")


# ------------------------------------------------------------------- sections

def write_header(w, hier_uuid, ias_uuid, version):
    for prefix, iri in PREFIXES.items():
        w.raw(f"@prefix {prefix}: <{iri}> .")
    w.raw()
    w.raw("# " + "=" * 76)
    w.raw("# NeST cancer systems map + IAS protein-association network")
    w.raw(f"# Generated by {TOOL_VERSION} on "
          f"{datetime.date.today().isoformat()}")
    w.raw(f"#   hierarchy  NDEx {hier_uuid}")
    w.raw(f"#   IAS        NDEx {ias_uuid}")
    w.raw("#")
    w.raw("# READ BEFORE QUERYING")
    w.raw("#  1. biolink:interacts_with is SYMMETRIC, but only ONE direction is written per")
    w.raw("#     edge. A query that does not perform OWL reasoning must match both, e.g.")
    w.raw("#       { ?a biolink:interacts_with ?b } UNION { ?b biolink:interacts_with ?a }")
    w.raw("#     or  ?a ^biolink:interacts_with|biolink:interacts_with ?b")
    w.raw("#  2. Minted statement IRIs (nest:e<n>) are BUILD-SCOPED and change whenever the")
    w.raw("#     source network is refiltered. A new build REPLACES this graph; never merge")
    w.raw("#     it into an existing load. See pav:version on the dataset node.")
    w.raw("# " + "=" * 76)
    w.raw()


def write_vocabulary(w):
    w.raw("# ---- minted vocabulary ------------------------------------------------")
    w.block("ndexv:ProteinSystem a rdfs:Class, owl:Class ;", [
        ("rdfs:label", '"protein system"'),
        ("rdfs:comment", '"A set of proteins identified as functioning together, derived by '
                         'multiscale community detection over a protein-association network. '
                         'Spans scales from protein complexes to broad cellular processes."'),
        ("rdfs:subClassOf", "biolink:BiologicalEntity"),
    ])
    w.block("ndexv:memberCount a rdf:Property, owl:DatatypeProperty ;", [
        ("rdfs:label", '"member count"'),
        ("rdfs:comment", '"Number of distinct member proteins in the system as reported by '
                         'the source. NOT necessarily the number of emitted '
                         'biolink:has_member triples: membership is suppressed above the '
                         'size cutoff, and a few members have no node in the interaction '
                         'network."'),
        ("rdfs:subPropertyOf", "biolink:has_count"),
        ("rdfs:domain", "ndexv:ProteinSystem"),
        ("rdfs:range", "xsd:nonNegativeInteger"),
    ])
    w.block("nestv:tumorsMutatedFraction a rdf:Property, owl:DatatypeProperty ;", [
        ("rdfs:label", '"tumors mutated fraction"'),
        ("rdfs:comment", '"Fraction of tumors in the cohort carrying at least one somatic '
                         'mutation in any member gene of the system. Numerator: patients '
                         'with >=1 mutated member. Denominator: patients in the cohort."'),
        ("rdfs:subPropertyOf", "biolink:has_quotient"),
        ("rdfs:domain", "biolink:Association"),
        ("rdfs:range", "xsd:double"),
    ])
    w.block("nestv:hisigWeight a rdf:Property, owl:DatatypeProperty ;", [
        ("rdfs:label", '"HiSig weight"'),
        ("rdfs:comment", '"Lasso coefficient assigned to the system by HiSig - how much of '
                         'the observed mutational signal the model attributes to it. One '
                         'value per system, from the pan-cancer run. NOT a significance '
                         'measure: read it together with nestv:hisigAdjustedPValue, emitted '
                         'on the same node for every system."'),
        ("rdfs:seeAlso", "STATO:0000565"),
        ("rdfs:domain", "ndexv:ProteinSystem"),
        ("rdfs:range", "xsd:double"),
    ])
    w.block("nestv:hisigAdjustedPValue a rdf:Property, owl:DatatypeProperty ;", [
        ("rdfs:label", '"HiSig adjusted p-value"'),
        ("rdfs:comment", '"Benjamini-Hochberg-corrected empirical p-value from HiSig\'s '
                         'permutation test, pan-cancer. One value per system, emitted for '
                         'all systems; many are exactly 1.0, i.e. not significant."'),
        ("rdfs:seeAlso", "OBI:0000175"),
        ("rdfs:seeAlso", BH),
        ("rdfs:domain", "ndexv:ProteinSystem"),
        ("rdfs:range", "xsd:double"),
    ])
    w.block("iasv:integratedAssociationStringency a rdf:Property, owl:DatatypeProperty ;", [
        ("rdfs:label", '"integrated association stringency"'),
        ("rdfs:comment", '"The IAS score: a granularity/stringency measure of shared-system '
                         'membership, trained to predict GO semantic similarity. NOT a '
                         'probability, p-value, or binding score."'),
        ("rdfs:domain", "rdf:Statement"),
        ("rdfs:range", "xsd:double"),
    ])
    w.block("iasv:retainedForConnectivity a rdf:Property, owl:DatatypeProperty ;", [
        ("rdfs:label", '"retained for connectivity"'),
        ("rdfs:comment", '"True on an edge kept only because it is one of its proteins\' '
                         'single highest-scoring edge, i.e. below the IAS core threshold. '
                         'Emitted only where true."'),
        ("rdfs:domain", "rdf:Statement"),
        ("rdfs:range", "xsd:boolean"),
    ])


def write_provenance(w, hier_uuid, ias_uuid, version):
    w.raw("# ---- provenance -------------------------------------------------------")
    w.block("nest:nest-kg a void:Dataset, prov:Entity ;", [
        ("dcterms:title", '"NeST cancer systems map with IAS protein-association network"'),
        ("dcterms:description",
         '"NeST 1.0 hierarchy of protein systems under mutational selection across 13 '
         'cancer types, with the filtered IAS protein-association network its members are '
         'drawn from."'),
        ("dcterms:publisher", "<https://www.ndexbio.org>"),
        ("dcterms:source", f"<{DOI}>"),
        ("dcterms:created", f'"{datetime.date.today().isoformat()}"^^xsd:date'),
        ("pav:version", f'"{esc(version)}"'),
        ("prov:wasDerivedFrom", f"ndex:{hier_uuid}"),
        ("prov:wasDerivedFrom", f"ndex:{ias_uuid}"),
        ("prov:wasGeneratedBy",
         f'[ a prov:Activity ; prov:wasAssociatedWith '
         f'<https://github.com/ndexbio/proto-okn> ; pav:version "{TOOL_VERSION}" ]',
         None, 4),
    ])


def write_hierarchy(w, hier, mondo, cutoff, stats):
    A = aspects(hier)
    decls = A["attributeDeclarations"][0]
    na = alias_map(decls, "nodes")
    nodes = [(n["id"], attrs(n, na)) for n in A["nodes"]]
    by_id = dict(nodes)

    local = lambda v: "nest:" + v["NEST ID"].replace(":", "-")

    w.raw("# ---- system nodes -----------------------------------------------------")
    for _id, v in nodes:
        pairs = [("a", "ndexv:ProteinSystem"),
                 ("rdfs:label", f'"{esc(v["Annotation"])}"'),
                 ("dcterms:identifier", f'"{esc(v["NEST ID"])}"'),
                 ("ndexv:memberCount", nonneg(v["Size"]))]
        weight = v.get("Weight")
        if weight:                                   # skipped when 0 (the root only)
            pairs.append(("nestv:hisigWeight", dbl(weight)))
        pval = v.get("adjusted  p-value")            # NOTE: two spaces in the source name
        if pval is not None:
            pairs.append(("nestv:hisigAdjustedPValue", dbl(pval)))
        w.block(local(v) + " ", pairs)
        stats["systems"] += 1

    w.raw("# ---- containment: child part_of parent --------------------------------")
    for e in A["edges"]:                             # edges run parent(s) -> child(t)
        w.triple(local(by_id[e["t"]]), "biolink:part_of", local(by_id[e["s"]]))
        stats["part_of"] += 1
    w.raw()

    small = [(i, v) for i, v in nodes if int(v["Size"]) < cutoff]
    stats["suppressed"] = len(nodes) - len(small)
    # Membership itself is written later, once the IAS node -> IRI table exists.
    return nodes, small, local


def write_membership(w, small, ias_iri, local, stats):
    for _id, v in small:
        iris = [ias_iri[m] for m in (v.get("HCX::members") or []) if m in ias_iri]
        if not iris:
            continue
        w.raw_triples(f"{local(v)} biolink:has_member " + ",\n        ".join(iris) + " .",
                      len(iris))
        stats["member_emitted"] += len(iris)
    w.raw()


def write_associations(w, small, mondo, local, stats):
    w.raw("# ---- associations: per significantly-mutated cancer type --------------")
    for _id, v in small:
        codes = (v.get("Significantly mutated cancer types") or "").split()
        sid = v["NEST ID"].replace(":", "-")
        for code in sorted(codes):
            if code not in mondo:
                print(f"  WARNING: {v['NEST ID']} cohort {code!r} not in the MONDO map",
                      file=sys.stderr)
                continue
            term, label = mondo[code]
            freq = v.get(f"Mutation frequency:{code}")
            pairs = [("a", "biolink:Association"),
                     ("biolink:subject", local(v)),
                     ("biolink:predicate", "biolink:genetically_associated_with"),
                     ("biolink:object", term, label)]
            if freq is not None:
                pairs.append(("nestv:tumorsMutatedFraction", dbl(freq)))
            pairs += [("biolink:knowledge_level", "biolink:statistical_association"),
                      ("biolink:agent_type", "biolink:data_analysis_pipeline"),
                      ("biolink:has_evidence", EVIDENCE)]
            w.block(f"nest:{sid}-{code} ", pairs)
            stats["assoc_cohort"] += 1

    w.raw("# ---- associations: pan-cancer HiSig selection (adj p < 0.05) ----------")
    for _id, v in small:
        pval = v.get("adjusted  p-value")
        if pval is None or pval >= 0.05:
            continue
        sid = v["NEST ID"].replace(":", "-")
        w.block(f"nest:{sid}-hisig ", [
            ("a", "biolink:Association"),
            ("biolink:subject", local(v)),
            ("biolink:predicate", "biolink:genetically_associated_with"),
            ("biolink:object", CANCER, "cancer"),
            ("biolink:knowledge_level", "biolink:statistical_association"),
            ("biolink:agent_type", "biolink:data_analysis_pipeline"),
            ("biolink:has_evidence", EVIDENCE),
        ])
        stats["assoc_pan"] += 1


def write_ias(w, ias, stats):
    A = aspects(ias)
    decls = A["attributeDeclarations"][0]
    na, ea = alias_map(decls, "nodes"), alias_map(decls, "edges")
    context = json.loads(A["networkAttributes"][0].get("@context") or "{}")

    w.raw("# ---- IAS protein nodes ------------------------------------------------")
    ias_iri = {}
    for n in A["nodes"]:
        v = attrs(n, na)
        term = curie_to_term(v.get("represents", ""), context)
        if term is None:
            print(f"  WARNING: IAS node {n['id']} has unresolvable represents "
                  f"{v.get('represents')!r}; skipped", file=sys.stderr)
            continue
        ias_iri[n["id"]] = term
        cls = NODE_CLASS.get((v.get("type") or "").lower(), NODE_CLASS["protein"])
        w.triple(term, "a", cls)
        w.triple(term, "rdfs:label", f'"{esc(v["name"])}"')
        stats["proteins"] += 1
    w.raw()

    # Nodes are keyed on gene symbol in the CX2, but RDF IRIs come from `represents` (a
    # UniProt accession), and 35 accessions are shared by 96 symbols (histone clusters,
    # tandem paralogs). An edge between two symbols sharing an accession therefore collapses
    # to a self-loop, which would assert that a protein interacts with itself. Drop those,
    # matching the NCI-PID adapter's behaviour.
    def endpoints(e):
        s, t = ias_iri.get(e["s"]), ias_iri.get(e["t"])
        if s is None or t is None:
            return None
        if s == t:
            return "selfloop"
        return s, t

    w.raw("# ---- IAS interactions: ONE triple per edge (symmetry not materialized) -")
    for e in A["edges"]:
        ends = endpoints(e)
        if ends is None:
            continue
        if ends == "selfloop":
            stats["selfloops"] += 1
            continue
        w.triple(ends[0], "biolink:interacts_with", ends[1])
        stats["interactions"] += 1
    w.raw()

    w.raw("# ---- IAS per-edge score -----------------------------------------------")
    for e in A["edges"]:
        ends = endpoints(e)
        if ends is None or ends == "selfloop":
            continue
        s, t = ends
        v = attrs(e, ea)
        pairs = [("a", "rdf:Statement"),
                 ("rdf:subject", s),
                 ("rdf:predicate", "biolink:interacts_with"),
                 ("rdf:object", t)]
        score = v.get("integrated_score")
        if score is not None:
            pairs.append(("iasv:integratedAssociationStringency", dbl(score)))
        if v.get("edge_role") == "backbone":
            pairs.append(("iasv:retainedForConnectivity", '"true"^^xsd:boolean'))
            stats["backbone"] += 1
        w.block(f"nest:e{e['id']} ", pairs)
        stats["statements"] += 1
    return ias_iri


# ------------------------------------------------------------------------ main

def positive_int(text):
    """
    An argparse type that rejects non-integers and non-positive values.

    `type=int` alone would accept 0 and negatives, which silently suppress every system's
    membership and associations rather than failing.
    """
    try:
        value = int(text)
    except ValueError:
        raise argparse.ArgumentTypeError(f"expected an integer, got {text!r}")
    if value < 1:
        raise argparse.ArgumentTypeError(f"expected an integer >= 1, got {value}")
    return value


def load_mondo(path):
    out = {}
    with open(path) as fh:
        for row in csv.DictReader(fh, delimiter="\t"):
            if row.get("mondo_id"):
                out[row["code"]] = (row["mondo_id"], row["mondo_label"])
    return out


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("uuid", help="NDEx UUID of the NeST hierarchy (HCX network)")
    ap.add_argument("-o", "--out", default="nest.ttl", help="output Turtle file")
    ap.add_argument("--cutoff", type=positive_int, default=400,
                    help="systems with Size >= this emit no membership or associations "
                         "(default 400)")
    ap.add_argument("--mondo", default=os.path.join(here, "cancer_type_mondo_map.tsv"),
                    help="cohort -> MONDO mapping")
    ap.add_argument("--cache-dir", default=os.path.join(here, ".ndex-cache"),
                    help="where downloaded CX2 files are cached")
    ap.add_argument("--ndex", default=NDEX_DEFAULT, help="NDEx server base URL")
    ap.add_argument("--offline", action="store_true",
                    help="fail instead of downloading if a network is not cached")
    ap.add_argument("--dataset-version", default="1.0",
                    help="pav:version recorded on the dataset node")
    ap.add_argument("--idle-timeout", type=positive_int, default=300, metavar="SECONDS",
                    help="abort a download that stalls for this long (default 300). This is "
                         "an idle timeout, not a total deadline: a slow but progressing "
                         "transfer is never cut off.")
    args = ap.parse_args()

    print("resolving networks", file=sys.stderr)
    hier = fetch_cx2(args.ndex, args.uuid, args.cache_dir, args.offline, args.idle_timeout)
    hna = aspects(hier)["networkAttributes"][0]
    if hna.get("ndexSchema") != "hierarchy_v0.1":
        print(f"  WARNING: ndexSchema is {hna.get('ndexSchema')!r}, expected "
              f"'hierarchy_v0.1' — is this an HCX hierarchy?", file=sys.stderr)
    ias_uuid = hna.get("HCX::interactionNetworkUUID")
    if not ias_uuid:
        sys.exit("ERROR: the hierarchy has no HCX::interactionNetworkUUID attribute, so the "
                 "interaction network cannot be located.")
    print(f"  interaction network: {ias_uuid}", file=sys.stderr)
    ias = fetch_cx2(args.ndex, ias_uuid, args.cache_dir, args.offline, args.idle_timeout)

    mondo = load_mondo(args.mondo)
    print(f"  cohort -> MONDO entries: {len(mondo)}", file=sys.stderr)

    stats = dict(systems=0, part_of=0, member_emitted=0, assoc_cohort=0,
                 assoc_pan=0, proteins=0, interactions=0, statements=0, backbone=0,
                 suppressed=0, selfloops=0)

    print(f"writing {args.out}", file=sys.stderr, flush=True)
    with open(args.out, "w") as fh:
        w = Writer(fh)
        write_header(w, args.uuid, ias_uuid, args.dataset_version)
        write_vocabulary(w)
        write_provenance(w, args.uuid, ias_uuid, args.dataset_version)
        nodes, small, local = write_hierarchy(w, hier, mondo, args.cutoff, stats)
        ias_iri = write_ias(w, ias, stats)
        # membership needs the IAS node -> IRI table, so it is written after the IAS nodes
        w.raw(f"# ---- membership (systems with Size < {args.cutoff}) ------------------")
        write_membership(w, small, ias_iri, local, stats)
        write_associations(w, small, mondo, local, stats)

    print("\ndone", file=sys.stderr)
    print(f"  systems .................. {stats['systems']:>9,} "
          f"({stats['suppressed']} above the cutoff emit no payload)", file=sys.stderr)
    print(f"  part_of .................. {stats['part_of']:>9,}", file=sys.stderr)
    print(f"  has_member ............... {stats['member_emitted']:>9,}", file=sys.stderr)
    print(f"  associations (per-cohort)  {stats['assoc_cohort']:>9,}", file=sys.stderr)
    print(f"  associations (pan-cancer)  {stats['assoc_pan']:>9,}", file=sys.stderr)
    print(f"  protein nodes ............ {stats['proteins']:>9,}", file=sys.stderr)
    print(f"  interactions ............. {stats['interactions']:>9,}", file=sys.stderr)
    print(f"  edge statements .......... {stats['statements']:>9,} "
          f"({stats['backbone']:,} backbone)", file=sys.stderr)
    if stats['selfloops']:
        print(f"  self-loops dropped ....... {stats['selfloops']:>9,} "
              f"(symbols sharing a UniProt accession)", file=sys.stderr)
    print(f"  TRIPLES WRITTEN .......... {w.count:>9,}", file=sys.stderr)
    print("    a loaded graph holds slightly fewer: RDF is a set, and a few triples",
          file=sys.stderr)
    print("    coincide where distinct gene symbols share one UniProt accession",
          file=sys.stderr)
    print(f"  -> {args.out} ({os.path.getsize(args.out):,} bytes)", file=sys.stderr)


if __name__ == "__main__":
    main()
