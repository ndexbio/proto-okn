# Remaining Issues

**Audited:** 2026-08-04 · **Auditor:** Claude (session notes) · **Reviewer:** (pending)

Findings from an audit of the two OKN contributions — the **NCI-PID 2.0 KG** (deployed) and
the **NeST + IAS KG** (generated, not deployed) — against the code, the generated Turtle, and
the live SPARQL endpoints.

**Method.** Every claim below was verified against a running system, not read from a document.
Partner-graph and NCI-PID facts come from `https://apps.okn.us/<graph>/sparql`; NeST facts
come from re-running both converters and diffing their output against the committed
`nest/nest.ttl`. Reproduction commands are given inline. Where something was *not* checked, it
says so.

Companion docs: [CX2_TO_RDF_DESIGN.md](CX2_TO_RDF_DESIGN.md),
[NEST_HIERARCHY_DATASET.md](NEST_HIERARCHY_DATASET.md),
[IAS_NETWORK_GENERATION.md](IAS_NETWORK_GENERATION.md).

---

## Summary

| # | Issue | Graph | Severity |
|---|---|---|---|
| 1 | NDEx source deposits are `UNLISTED` / owned by `cjtest`, and `nest.ttl` already cites them | NeST | **blocker** |
| 2 | `file:///mnt/repo/...` filesystem paths leaked into entity IRIs | NCI-PID | **blocker** — *converter fixed, needs re-publish* |
| 3 | 30 entities carry relative (scheme-less) IRIs | NCI-PID | **blocker** — *converter fixed, needs re-publish* |
| 4 | NeST is generated but not deposited or served | NeST | high |
| 5 | Pathway provenance (design §4.8) is absent from the deployed graph | NCI-PID | high |
| 6 | 61 non-protein entities typed `SIO:010043` (protein) | NCI-PID | high — *converter fixed, needs re-publish* |
| 7 | `example.org` placeholder base still in the published graph | NCI-PID | medium — *converter fixed, needs re-publish* |
| 8 | Cross-graph joins silently lose 79% of overlap without `owl:sameAs` | both | medium |
| 9 | Bioregistry canonicalization not applied to `chebi` / `cas` | NCI-PID | medium — *converter fixed, needs re-publish* |
| 10 | Bioregistry `ndex` record has no `rdf_uri_format` | both | medium |
| 11 | `merge_cx2.py` writes the superseded NDEx IRI stem | NCI-PID | medium |
| 12 | Converter debt in `bio-cx2-to-rdf` | NCI-PID | low |
| 13 | Endpoint host recorded inconsistently | NCI-PID | low |
| 14 | `nest.ttl` (57 MB) committed to git | NeST | low |
| 15 | Vocabulary axioms emitted but unreviewed | NeST | low |

---

## Blockers

### 1. NDEx source deposits are `UNLISTED` and owned by `cjtest`

Both networks that `nest.ttl` cites as `prov:wasDerivedFrom` are unlisted and owned by a
test account. This was already tracked as a future concern, but it is now a **defect in a
generated artifact**: the provenance IRIs in the shipped Turtle do not resolve for anyone
outside the owning account.

```bash
for u in 4f9210a1-8797-11f1-857e-005056ae3c32 4731187a-8796-11f1-857e-005056ae3c32; do
  curl -s "https://www.ndexbio.org/v2/network/$u/summary" \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['visibility'],d['owner'])"
done
# UNLISTED cjtest
# UNLISTED cjtest
```

**Fix:** make both **PUBLIC** and move to a durable owner before publishing. Gates issue 4.

### 2. Filesystem paths leaked into entity IRIs

19 entities in the **published** graph are identified by the loader's local filesystem path,
across **969 triples**. These arise from source nodes whose `represents` is a bare name
(protein families like `GSK3`/`ETS`, miRNAs, `LPS`) that got resolved relative to the file
being loaded rather than minted into a namespace.

```bash
curl -s -X POST -H "Accept: application/sparql-results+json" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "query=SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o . FILTER((isIRI(?s)&&STRSTARTS(STR(?s),'file://'))||(isIRI(?o)&&STRSTARTS(STR(?o),'file://'))) }" \
  https://apps.okn.us/ncipidkg/sparql
# 969
```

Examples: `file:///mnt/repo/ncipidkg/main/GSK3`, `.../MIR146A`, `.../LPS`, `.../ETS`.

These IRIs leak build-host detail, can never join with another graph, and do not dereference.
**Fix:** mint unresolvable-`represents` nodes into an owned namespace (the family pattern in
design §4.9.1 already does this for `proteinfamily`; extend it to the other bare-name types)
and re-publish.

> **Fixed in the converter (2026-08-10), not yet re-published.** Bare-name `represents` values
> are now minted as `https://www.ndexbio.org/identifiers/entity/<slug>` (`buildEntityUri`,
> `uri-builder.ts`). All 19 distinct bare names are covered; a corpus-wide conversion of all
> 217 networks emits zero relative IRIs.

### 3. Relative, scheme-less IRIs

30 subjects and 28 objects are stored as bare CURIEs with no scheme — e.g. the literal IRI
`CHEBI:15354`. A relative IRI has no stable identity, will not join, and is arguably invalid
as a published RDF identifier.

```bash
curl -s -X POST -H "Accept: application/sparql-results+json" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "query=SELECT (COUNT(DISTINCT ?s) AS ?n) WHERE { ?s ?p ?o . FILTER(isIRI(?s)&&!CONTAINS(STR(?s),'://')) }" \
  https://apps.okn.us/ncipidkg/sparql
# 30
```

All 30 are ChEBI small molecules (choline, cholesterol, prostaglandin I2, cAMP/cGMP,
phosphatidic acid, …). Related to issues 6 and 9. **Fix:** expand through the `@context` /
Bioregistry stem to `http://purl.obolibrary.org/obo/CHEBI_15354` at conversion time.

> **Fixed in the converter (2026-08-10), not yet re-published.** Root cause was case-sensitive
> prefix lookup: the `@context` declares `chebi` but every node writes `CHEBI:`. Prefix
> resolution is now case-insensitive (`resolvePrefix`, `namespace-manager.ts`), and the
> Bioregistry map is seeded as a floor so networks shipping no `@context` still resolve.

---

## High

### 4. NeST is generated but not deposited or served

`nest/nest.ttl` exists and is correct — 1,318,375 triples, reproducible byte-for-byte from
either converter — but it is not published. There is no `nest` entry in the OKN registry and
no SPARQL service.

```bash
curl -s "https://apps.okn.us/nest/sparql?query=SELECT%20*%20WHERE%7B%3Fs%20%3Fp%20%3Fo%7D%20LIMIT%201" | head -c 40
# <!doctype html>  ← the registry web app, not a query endpoint
```

Note the endpoint host answers `200` for *any* path, so an HTTP status check is not a valid
liveness test — compare response bodies against a deliberately fake graph name.

Every federated use case involving NeST is therefore runnable only against the local file
today. Gated on issue 1.

### 5. Pathway provenance is absent from the deployed graph

Design §4.8 specifies pathway provenance nodes, `RO:0000056 participates_in`, and
`okn:inPathway`. The code implements it and the local `bio-cx2-to-rdf/merged.ttl` contains it
— but the **deployed** graph has none of it:

```bash
# all three return 0 against https://apps.okn.us/ncipidkg/sparql
SELECT (COUNT(*) AS ?n) WHERE { ?s a <https://w3id.org/biolink/vocab/Pathway> }
SELECT (COUNT(*) AS ?n) WHERE { ?s <http://purl.obolibrary.org/obo/RO_0000056> ?o }
SELECT (COUNT(*) AS ?n) WHERE { ?s <http://example.org/okn/inPathway> ?o }
```

The deployed build predates the merge. Any query or use case that scopes interactions by
pathway will silently return nothing. **Fix:** re-publish from the merged network.

### 6. Non-protein entities typed as protein

61 distinct non-UniProt subjects are typed `SIO:010043` (protein). They include small
molecules — choline, cholesterol, thromboxane A2, 11-cis-retinal — and bare-name nodes such
as `LPS` and miRNAs. Design §4.2 maps `smallmolecule` to `CHEBI:23367` and `mirna` to
`SO:0000276`, so this is a conversion defect, not a design gap.

```bash
SELECT (COUNT(DISTINCT ?s) AS ?n) WHERE {
  ?s a <http://semanticscience.org/resource/SIO_010043> .
  FILTER(!STRSTARTS(STR(?s),'http://purl.uniprot.org/'))
}
# 61
```

Consequence: a consumer selecting "all proteins" gets cholesterol. **Fix:** honour the
node `type` attribute in the type mapping and re-publish.

> **Fixed in the converter (2026-08-10), not yet re-published.** The 3-entry type map with its
> `?? typeMap.protein` fallback is replaced by the verified §4.2 table with **no default**
> (`nodeTypeToClassUri`). Small molecules now type as `CHEBI:23367`, families as
> `biolink:GeneFamily`, `RnaReference` as `SO:0000655`. Corpus-wide, zero ChEBI/PubChem
> entities are typed `SIO:010043`.

---

## Medium

### 7. `example.org` placeholder base in the published graph

83,704 statement IRIs and 20 family IRIs use `http://example.org/okn/`, along with every
custom property (`okn:evidenceCount`, `okn:evidenceUrl`, `okn:processType`, `okn:inPathway`).
`example.org` is reserved for documentation and must not carry production identity.

> **Fixed in the converter (2026-08-10), not yet re-published.** Entities now mint under
> `https://www.ndexbio.org/identifiers/` and vocabulary terms under
> `https://www.ndexbio.org/vocab/ncipid/` (`namespace-manager.ts`), matching the NeST/IAS
> convention. Corpus-wide conversion of all 217 networks emits zero `example.org` IRIs.

The NeST/IAS graphs already retired this in favour of `https://www.ndexbio.org/vocab/` and
`https://www.ndexbio.org/identifiers/` ([IAS §8](IAS_NETWORK_GENERATION.md)). NCI-PID should
follow, for consistency across our own two contributions. Hardcoded in
`bio-cx2-to-rdf/src/core/namespace-manager.ts`, `src/core/turtle-writer.ts`, and
`src/adapters/nci-pid/index.ts`.

### 8. Cross-graph joins need `owl:sameAs` expansion

NCI-PID carries non-canonical and isoform accessions from its source networks (BTG2 is
`A0A024R986`, not the canonical `P78543`), while NeST resolves HGNC symbols to reviewed
Swiss-Prot canonicals. Matching protein IRIs directly recovers **526** proteins; expanding
first through NCI-PID's 11,760 `owl:sameAs` triples recovers **2,451**, against a gene-symbol
ceiling of 2,463 — **99.5%** of what is achievable.

A federated query that omits the `sameAs` step therefore drops ~79% of the overlap **and
still returns plausible-looking results**. This affects every join to the four OKN graphs
sharing our `purl.uniprot.org` stem (ProKN, BiomarkerKB, AOP-Wiki, and NeST itself).

**Fix:** document the required join pattern wherever these graphs are described, and rely on
FRINK's node normalizer where available.

### 9. Bioregistry canonicalization not applied to `chebi` / `cas`

Design §4.1.1 says `@context` prefixes are canonicalized against a vendored Bioregistry
snapshot, with `chebi` → `http://purl.obolibrary.org/obo/CHEBI_`. In practice
`merged.ttl` declares `@prefix chebi: <https://identifiers.org/chebi/CHEBI:>` and the deployed
graph has bare CURIEs (issue 3), while 12 subjects sit on `https://identifiers.org/cas/`.
Either the snapshot lacks these prefixes or canonicalization is not running on this path —
**not diagnosed**; needs a look at `createNamespaceMap` / `canonicalizeContext`.

### 10. Bioregistry `ndex` record has no `rdf_uri_format`

Confirmed still true (2026-08-04): the record carries only
`uri_format = https://www.ndexbio.org/viewer/networks/$1`. Automatic canonicalization
therefore cannot pick up an NDEx IRI stem, and it must be set deliberately in the converter.
NDEx is our own resource, so contributing the field upstream is ours to do.

### 11. `merge_cx2.py` writes the superseded NDEx stem

`util/merge_cx2.py` binds `ndex → https://www.ndexbio.org/v3/networks/` (lines 23, 278, 501),
while the settled choice is the Bioregistry-registered viewer form
`https://www.ndexbio.org/viewer/networks/` used by `nest_to_rdf`. Left unchanged, two IRI
forms for the same NDEx network will coexist across our two graphs.

---

## Low

### 12. Converter debt in `bio-cx2-to-rdf`

Now that NeST ships as standalone converters and no adapter is planned for it, these are
NCI-PID-side debt rather than blockers:

- `RdfOutput` has no literal-valued triple type; `directTriples` takes IRI objects only
- `ReifiedStatement` hardcodes the NCI-PID evidence fields rather than generic qualifiers
- no adapter registry — `cli/index.ts` calls the NCI-PID adapter directly
- output accumulates in memory rather than streaming

### 13. Endpoint host recorded inconsistently

[nci-pidkg.md](nci-pidkg.md) records `https://frink.apps.renci.org/ncipidkg/sparql`; the
registry publishes `https://apps.okn.us/ncipidkg/sparql`. Both currently answer, so this is
cosmetic — but the two should agree, and published materials should use one.

### 14. `nest.ttl` (57 MB) committed to git

Convenient for review and for running use cases offline, but it is a generated artifact
reproducible byte-for-byte from two cached inputs. Decide whether it belongs in the
repository long-term or in a release/LFS.

### 15. Vocabulary axioms emitted but unreviewed

The seven minted terms in `nest.ttl` have not had a modelling review — in particular whether
`SIO:000616` (collection) is worth carrying as a superclass of `ndexv:ProteinSystem`. Note
the shipped `rdfs:comment` strings are lightly reworded from the design draft; §6 of
[NEST_HIERARCHY_DATASET.md](NEST_HIERARCHY_DATASET.md) is the design of record, `nest.ttl`
the exact published text.

---

## Documentation corrected in this pass

The design docs had drifted from the implementation. Fixed on 2026-08-04:

- **NeST RDF was described as unimplemented** in three places. It ships as
  `nest/nest_to_rdf.{py,mjs}` → `nest/nest.ttl`. The two converters produce byte-identical
  output (sha256 `3a7a8a58…`) and diffing them is the regression test.
- **The RDF stage reads NDEx by UUID, not the local CX2 files** — never documented. Editing
  `IAS_network.cx2` locally has no effect on `nest.ttl` until it is re-deposited.
- **Four shapes in [CX2_TO_RDF_DESIGN.md](CX2_TO_RDF_DESIGN.md) were never implemented as
  written**: the `okn:` base, PTM typing (`okn:processType` predicate, not a second
  `rdf:type`), statement IRI form (`okn:statement_<edge>_<i>`, no `net:` scheme), and evidence
  provenance (`okn:evidenceUrl`; `dcterms:source` and `prov:wasDerivedFrom` are not emitted at
  all). Divergences 2 and 3 meant the doc's example SPARQL returned **zero rows** — corrected
  and re-tested against the live endpoint. A divergence table is now at §1.1.

---

## Not audited

Stated so the gaps are known rather than assumed clean:

- **~1,600 lines of [CX2_TO_RDF_DESIGN.md](CX2_TO_RDF_DESIGN.md)** were spot-checked, not read
  in full. The four divergences above were found in the sections that were read; there may be
  more. The long worked examples in §4.4.1–4.4.2, §6.2–6.3 and §11 still show the old shapes
  and are labelled as such rather than rewritten.
- **`nest.ttl` was not parsed by a validating RDF parser.** No `rdflib`, `riot` or `rapper` is
  available in this environment; structure was verified by counting and by converter
  agreement, which would not catch a syntax error that both converters make identically.
  Worth one `riot --validate` before deposit.
- **`SYMBOL_TO_PROTEIN_MAPPING.md`** was not audited against its scripts.
- **The NCI-PID deployed graph was not diffed against `merged.ttl`** beyond the pathway check
  in issue 5; other content differences between the deployed build and the current code are
  unknown.
- **Partner-graph statistics** were read from live endpoints at a single point in time and
  will drift.
