# Biological CX2 to RDF Conversion - Design Document
## Multi-Dataset Network Converter with Dataset-Specific Adapters

## 1. Executive Summary

This document describes the architecture and design for the **bio-cx2-to-rdf** converter, a multi-dataset tool for converting biological networks in Cytoscape CX2 format into RDF (Resource Description Framework) expressed in Turtle syntax.

**Project Scope**: The converter uses a **dataset-specific adapter pattern** to support multiple biological network datasets, each with unique characteristics and semantic requirements. Currently supported datasets:
1. **NCI-PID 2.0** - NCI Pathway Interaction Database version 2.0 networks
2. **Nest Hierarchy** - Nested hierarchical biological networks (adapter in development)

**NCI-PID 2.0 Adapter**: This document primarily describes the NCI-PID 2.0 adapter implementation. The NCI Pathway Interaction Database (NCI-PID) version 2.0 networks have been enhanced with INDRA (Integrated Network and Dynamical Reasoning Assembler) evidence and have specific characteristics including:
- Protein entities identified with UniProt IDs
- Relationship evidence from INDRA and/or NCI-PID sources
- HTML-formatted relationship lists with evidence links
- Confidence scores for relationship quality

**Adapter Pattern**: The converter employs a **dataset-specific adapter pattern** where:
- **Core converter** handles generic CX2 parsing, RDF generation, and Turtle serialization
- **Dataset adapters** (like NCI-PID 2.0) provide dataset-specific logic for:
  - Entity type recognition and mapping
  - Relationship extraction and normalization
  - Evidence metadata parsing
  - Ontology term selection

This architecture enables support for multiple biological network datasets (NCI-PID 2.0, Nest Hierarchy, and future additions) while maintaining a clean, maintainable codebase.

**Data Focus**: The converter processes only the semantic network data (nodes, edges, attributes, metadata). Visual presentation aspects such as `visualProperties`, `visualEditorProperties`, and `nodeBypasses`/`edgeBypasses` are **explicitly excluded** from conversion as they do not contribute to the knowledge graph semantics.

## 2. Background

### 2.1 NCI-PID 2.0 Networks

The NCI Pathway Interaction Database (NCI-PID) was a curated collection of biomolecular interactions and cellular processes. NCI-PID 2.0 networks represent updated versions of original PID pathways, enhanced with:

- **INDRA Integration**: Relationships extracted from scientific literature using the INDRA (Integrated Network and Dynamical Reasoning Assembler) system
- **Evidence Provenance**: Links to source databases (INDRA, NCI-PID) and supporting literature
- **Confidence Metrics**: Quantitative scores indicating relationship reliability
- **Rich Annotations**: Detailed relationship types (binding, activation, phosphorylation, etc.)

These networks are distributed in CX2 format through platforms like NDEx (Network Data Exchange).

### 2.2 Source Format: CX2

CX2 (Cytoscape Exchange Format version 2) is a JSON-based format for representing biological networks. For NCI-PID 2.0 networks, relevant aspects include:

**Data Aspects** (converted to RDF):
- **attributeDeclarations**: Defines data types, defaults, and aliases for node/edge attributes
- **networkAttributes**: Network-level metadata (name, description, version, references)
- **nodes**: Biological entities (proteins) with identifiers, labels, and types
- **edges**: Relationships between entities with evidence and confidence scores

**Visual Aspects** (excluded from conversion):
- **visualProperties**: Default visual styles for nodes and edges
- **visualEditorProperties**: UI configuration for visual editing
- **nodeBypasses/edgeBypasses**: Individual element visual overrides
- **x, y coordinates**: Spatial layout information

### 2.3 Target Format: RDF Turtle

RDF (Resource Description Framework) is a W3C standard for representing information as subject-predicate-object triples. Turtle is a human-readable serialization format for RDF. The conversion focuses on capturing:

- Entity semantics (types, identifiers, labels)
- Relationship semantics (predicates, directionality)
- Evidence provenance (sources, confidence)
- Network metadata (descriptions, versions, citations)

## 3. Data Analysis

### 3.1 NCI-PID 2.0 Network Structure

Based on analysis of sample NCI-PID 2.0 network files in CX2 format:
- `small_example.cx2` - Small sumoylation pathway (16 nodes, 58 edges)
- `Ephri_B.cx2` - Ephrin B signaling pathway (156 KB)
- `Direct p53 effectors (v2.0).cx2` - p53 pathway network (1.1 MB)

**Note**: The following structure is specific to NCI-PID 2.0 networks. Other CX2 networks may have different attribute schemas, entity types, and metadata structures.

### 3.2 Relevant CX2 Aspects for Conversion

Attribute names below are given by their **canonical full names** (`name`, `represents`,
`interaction`, …). In a CX2 file these may be stored under a short alias or omitted in favor
of a declared default; the converter resolves both to the canonical name during parsing — see
[3.2.1 Attribute Declarations](#321-attribute-declarations-aliases-and-defaults).

#### Node Attributes:
- **id**: Numeric identifier (CX2 internal)
- **x, y**: Visual coordinates (not needed for RDF)
- **name** (alias `n`): Display label (gene symbol for proteins)
- **represents** (alias `r`): Entity identifier (e.g., `uniprot:Q13547`)
- **type** (may declare a default, e.g. "protein"): Entity type
- **alias**: List of alternative identifiers (used as `owl:sameAs` targets)

#### Edge Attributes:
- **id**: Numeric identifier (CX2 internal, used for generating relationship URIs)
- **s**: Source node ID (maps to subject entity)
- **t**: Target node ID (maps to object entity)
- **interaction** (alias `i`): ~~Simple interaction type~~ **[IGNORED for INDRA edges]** - Too generic for INDRA evidence; detailed relationships come from the Relationships attribute. (Pathway-membership edges are an exception handled by a separate design.)
- **Relationships**: HTML-formatted list of detailed relationship types with evidence links **[PRIMARY SOURCE]**
- **__edge_source** (may declare default "INDRA"): Evidence source ("INDRA" or "INDRA + NCI-PID") **[EXPORTED]**
- **__relationship_score**: ~~Confidence score (natural log of total evidence count)~~ **[IGNORED]** - Redundant; derive from evidence count if needed
- **__directed** (may declare default false): Boolean indicating if edge is directed **[IGNORED]**
- **__reverse_directed** (may declare default false): Boolean indicating if direction should be reversed **[IGNORED]**

#### Network Attributes:
- **@context**: Stringified JSON object defining namespace prefixes **[USED]**

### 3.2.1 Attribute Declarations (aliases and defaults)

Per the [CX2 v2 specification](https://cytoscape.org/cx/cx2/specification/cytoscape-exchange-format-specification-(version-2)/),
the `attributeDeclarations` aspect declares, per aspect (`nodes`, `edges`, `networkAttributes`),
a map of `fullName -> { d, a?, v? }`:

- **`d`** — data type (`string`, `integer`, `double`, `boolean`, `long`, or their `list_of_*` forms).
- **`a`** — optional alias. *"If an alias is declared, the full attribute name can no longer be
  used in the nodes or edges data blocks; the alias must be used instead."* Aliases are **not**
  permitted for `networkAttributes`.
- **`v`** — optional default. *"If an element is missing this attribute, it will be automatically
  assigned the default value."*

Because the same logical attribute can appear in a file as a short alias (e.g. `r`), as its full
name (`represents`), or omitted in favor of a default, the converter performs a **declaration-aware
normalization pass** before any RDF mapping. For each node/edge it rewrites the `v` bag to canonical
full-name keys:

1. The data key for attribute `X` is `decl.a ?? X`; the value is read from there (with a lenient
   fallback to the full name if a non-conforming file used it anyway).
2. If that key is absent and the declaration carries a default `v`, the default is materialized
   onto the element.
3. Undeclared keys are passed through unchanged.

This makes the converter independent of how a given file was serialized. In practice, NDEx
single-pathway exports use short aliases (`n`, `r`, `i`), whereas Cytoscape re-exports of a merged
network use long names and omit aliases — both normalize to the same canonical attributes.

### 3.3 Relationship HTML Parsing

The `Relationships` attribute contains HTML like:
```html
All Evidences (<a href="...">49</a>)
<ul>
<li/>MDM2 ubiquitinates HDAC1(<a href="...">12</a>)
<li/>MDM2 activates HDAC1(<a href="...">4</a>)
<li/>MDM2 inhibits HDAC1(<a href="...">3</a>)
</ul>
```

**Components to Extract:**

1. **Total evidence count** from "All Evidences" line: 49 (sum of all relationship evidences)
2. **Individual relationships** from each `<li/>` item:
   - Subject entity name
   - Predicate/verb (e.g., "ubiquitinates", "activates", "binds")
   - Object entity name
   - Evidence count for this specific relationship type
   - Evidence URL linking to supporting evidence

**Note**: The total evidence count (49) equals the sum of individual counts (12 + 4 + 3 + ... other relationships). The `__relationship_score` attribute is ln(49) = 3.89..., which we ignore in favor of the raw count.

## 4. RDF Ontology Design

### 4.1 Namespace Definitions

Note: `biolink:`, `PW:`, and `pathway:` below are emitted **only for merged networks that contain
pathway provenance nodes** (see [4.8](#48-merged-network-handling-pathway-provenance)); pathway-free
networks keep an unchanged prefix block. `pathway:` (= `…/okn/pathway/`) exists so pathway IRIs
compact (the trailing slash is not a valid CURIE local-name character under `okn:`).

```turtle
@prefix okn: <http://purl.org/okn/> .
@prefix pathway: <http://purl.org/okn/pathway/> .  # merged networks only; compacts pathway IRIs
@prefix uniprot: <http://purl.uniprot.org/uniprot/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .

# Standard biological ontologies (used for predicates and entity types)
@prefix SIO: <http://semanticscience.org/resource/SIO_> .
@prefix RO: <http://purl.obolibrary.org/obo/RO_> .
@prefix GO: <http://purl.obolibrary.org/obo/GO_> .
@prefix biolink: <https://w3id.org/biolink/vocab/> .  # pathway node typing (FRINK harmonization)
@prefix SO: <http://purl.obolibrary.org/obo/SO_> .
@prefix CHEBI: <http://purl.obolibrary.org/obo/CHEBI_> .
@prefix MONDO: <http://purl.obolibrary.org/obo/MONDO_> .
@prefix UPHENO: <http://purl.obolibrary.org/obo/UPHENO_> .
@prefix PW: <http://purl.obolibrary.org/obo/PW_> .
@prefix UBERON: <http://purl.obolibrary.org/obo/UBERON_> .
@prefix NCIT: <http://purl.obolibrary.org/obo/NCIT_> .
```

**Design Decision: Hybrid Standards-First Approach**

This converter uses a **hybrid approach** to minimize maintenance overhead while preserving semantic specificity:

1. **Use RO predicates directly** for relationships with direct equivalents (binds, activates, inhibits)
2. **Use reification with GO process terms** for PTMs where no standard predicate exists

| Category | Approach | Rationale |
|----------|----------|-----------|
| Binding, activation, inhibition | RO predicates directly | Direct equivalents exist, no maintenance needed |
| PTMs (phosphorylation, etc.) | Reification + GO process types | No standard predicates exist; GO terms capture specificity |

This eliminates custom relationship predicates (`oknr:*`) entirely, using only:
- `okn:` namespace for network-specific entities (statements, networks)
- Standard ontologies (RO, GO) for all relationship semantics

### 4.1.1 Identifier Canonicalization (Bioregistry)

Source CX2 networks declare their namespace prefixes in `networkAttributes.@context`, but those
often point at **non-preferred IRI bases** — e.g. `uniprot` → `https://identifiers.org/uniprot/`
rather than the OKN/Bioregistry-canonical `http://purl.uniprot.org/uniprot/`. The converter
**canonicalizes each `@context` prefix against [Bioregistry](https://bioregistry.io)** before
building entity IRIs (`createNamespaceMap` → `canonicalizeContext`):

- A prefix that Bioregistry exposes with an **`rdf_uri_format`** (a proper RDF identity IRI) is
  rewritten to that canonical stem — e.g. `uniprot` → `http://purl.uniprot.org/uniprot/`,
  `chebi` → `http://purl.obolibrary.org/obo/CHEBI_`.
- A prefix **without** an `rdf_uri_format` (Bioregistry's canonical is only a provider webpage —
  e.g. `cas`, `hgnc.symbol`, `hprd`, `kegg.compound`) is **left as the network's `@context`
  value**, since a webpage URL is a poor RDF subject IRI.

**Build-time, not conversion-time.** The canonical stems are vendored in
`src/core/bioregistry-prefixes.ts`, regenerated on demand by `scripts/refresh-bioregistry.js`
(`npm run refresh:bioregistry`), which queries the Bioregistry API. A pinned snapshot keeps
conversion **deterministic and offline** (important for a reproducible KG pipeline and for
browser/Cytoscape-Web use).

> **Future — live resolution.** As this becomes a more general cx2→RDF tool for *arbitrary*
> networks, the vendored snapshot won't cover every prefix a network might declare. The plan is to
> optionally resolve unknown `@context` prefixes against the **live Bioregistry API during
> conversion**, with caching, falling back to the snapshot/`@context`. Trade-off: live resolution is
> general but adds a network dependency and non-determinism; the build-time snapshot is deterministic
> and offline but limited to vendored prefixes. The split is by design — see this section.

**Scope.** This solves *namespace/base* canonicalization (same identifier, canonical IRI base). It
does **not** resolve *entity equivalence* — e.g. a non-canonical UniProt isoform accession, or a
gene symbol vs Entrez ID. Those are emitted with `owl:sameAs` links (from the node `alias` list) and
left to a downstream node normalizer (FRINK), which is the appropriate tool for open-ended
cross-identifier equivalence.

### 4.2 Entity Type Mapping

| CX2 Type | RDF Class | Notes |
|----------|-----------|-------|
| protein | `SIO:010043` (protein) | Semanticscience Integrated Ontology |
| complex | `SIO:010046` (protein complex) | Semanticscience Integrated Ontology |
| proteinfamily | `SIO:001380` (protein family) | Semanticscience Integrated Ontology |
| smallmolecule | `CHEBI:23367` (molecular entity) | ChEBI ontology; entity URI uses the specific CHEBI ID (e.g., `CHEBI:37550`) |
| chemical | `CHEBI:24431` (chemical entity) | ChEBI ontology |
| drug | `CHEBI:23888` (drug) | ChEBI ontology |
| gene | `SO:0000704` (gene) | Sequence Ontology |
| geneproduct | `SIO:010430` (gene product) | Semanticscience Integrated Ontology |
| variant | `SO:0001060` (sequence variant) | Sequence Ontology |
| rna | `SIO:010450` (RNA) | Semanticscience Integrated Ontology |
| RnaReference | `SIO:010450` (RNA) | Semanticscience Integrated Ontology (legacy CamelCase) |
| mrna | `SO:0000234` (mRNA) | Sequence Ontology |
| mirna | `SO:0000276` (miRNA) | Sequence Ontology |
| antibody | `SIO:010298` (antibody) | Semanticscience Integrated Ontology |
| disease | `MONDO:0000001` (disease) | Monarch Disease Ontology |
| phenotype | `UPHENO:0001001` (phenotype) | Unified Phenotype Ontology |
| cellularcomponent | `GO:0005575` (cellular component) | Gene Ontology |
| biologicalprocess | `GO:0008150` (biological process) | Gene Ontology |
| molecularfunction | `GO:0003674` (molecular function) | Gene Ontology |
| pathway | `biolink:Pathway` (pathway) | Biolink Model, for FRINK harmonization; asserted `owl:equivalentClass PW:0000001` (Pathway Ontology) to retain the OBO link. Used to type merged-network pathway provenance nodes (see [4.8](#48-merged-network-handling-pathway-provenance)). |
| tissue | `UBERON:0000479` (tissue) | Uberon anatomy ontology |
| signal | `SIO:000552` (signal) | Semanticscience Integrated Ontology |
| stimulus | `NCIT:C53415` (stimulus) | NCI Thesaurus |

**Note:** Type values in CX2 files typically use lowercase without spaces (e.g., `smallmolecule`, `proteinfamily`) except for legacy types like `RnaReference` which use CamelCase.

### 4.3 Relationship Predicate Mapping

#### 4.3.1 Direct RO Predicates (No Custom Predicates)

For relationships with direct RO equivalents, use RO predicates directly:

| Relationship Text | RDF Predicate | RO Term Label |
|-------------------|---------------|---------------|
| X binds Y | `RO:0002436` | molecularly interacts with |
| X activates Y | `RO:0002629` | directly positively regulates |
| X inhibits Y | `RO:0002630` | directly negatively regulates |
| X increases amount of Y | `RO:0002629` | directly positively regulates |
| X decreases amount of Y | `RO:0002630` | directly negatively regulates |

**No custom predicates needed** - tools recognize RO terms without reasoning.

#### 4.3.2 PTM Relationships (Reification with GO Process Types)

Post-translational modifications don't have direct RO predicates. We use:
- **Direct triple**: Generic `RO:0002578` (directly regulates)
- **Reified statement**: Typed with specific GO biological process term

| Relationship Text | Direct Predicate | Statement Type (GO Process) |
|-------------------|------------------|----------------------------|
| X phosphorylates Y | `RO:0002578` | `GO:0006468` (protein phosphorylation) |
| X dephosphorylates Y | `RO:0002578` | `GO:0006470` (protein dephosphorylation) |
| X ubiquitinates Y | `RO:0002578` | `GO:0016567` (protein ubiquitination) |
| X deubiquitinates Y | `RO:0002578` | `GO:0016579` (protein deubiquitination) |
| X sumoylates Y | `RO:0002578` | `GO:0016925` (protein sumoylation) |
| X desumoylates Y | `RO:0002578` | `GO:0016926` (protein desumoylation) |

**Benefits:**
- GO terms are universally recognized and well-maintained
- No custom predicates to maintain
- Specific PTM type is captured via statement typing
- Supports both generic queries (`?x RO:0002578 ?y`) and specific queries (`?stmt a GO:0016567`)

### 4.4 Reification Pattern for Relationship Metadata

Each relationship gets both a **direct triple** (for easy querying) and a **reified statement** (for metadata).

#### 4.4.1 Simple Relationships (binds, activates, inhibits)

```turtle
# Direct triple - uses RO predicate directly
uniprot:O75928 RO:0002436 uniprot:P63279 .  # PIAS1 molecularly interacts with UBE2I

# Reified statement for metadata
okn:e227_1 a rdf:Statement ;
    rdf:subject uniprot:O75928 ;
    rdf:predicate RO:0002436 ;
    rdf:object uniprot:P63279 ;
    okn:evidenceCount 32 ;
    dcterms:source "INDRA" ;
    prov:wasDerivedFrom <https://db.indra.bio/statements/...> .
```

#### 4.4.2 PTM Relationships (with GO Process Typing)

```turtle
# Direct triple - generic "directly regulates"
uniprot:O75928 RO:0002578 uniprot:Q13547 .  # PIAS1 directly regulates HDAC1

# Reified statement typed with GO process for PTM specificity
okn:e231_1 a rdf:Statement, GO:0016925 ;  # also typed as "protein sumoylation"
    rdf:subject uniprot:O75928 ;
    rdf:predicate RO:0002578 ;
    rdf:object uniprot:Q13547 ;
    okn:evidenceCount 8 ;
    dcterms:source "INDRA" ;
    prov:wasDerivedFrom <https://db.indra.bio/statements/...> .
```

**Key insight:** The GO process type on the reified statement captures the specific PTM semantics without needing a custom predicate.

#### 4.4.3 Reification Metadata Properties

Only minimal custom properties are needed (for metadata, not relationships):

```turtle
okn:evidenceCount a owl:DatatypeProperty ;
    rdfs:label "evidence count" ;
    rdfs:comment "Number of supporting evidences for this relationship" ;
    rdfs:domain rdf:Statement ;
    rdfs:range xsd:integer .
```

All other metadata uses standard vocabularies:
- `rdf:subject`, `rdf:predicate`, `rdf:object` - Standard RDF reification
- `dcterms:source` - Evidence source database(s)
- `prov:wasDerivedFrom` - Link to detailed evidence

One additional custom property links a reified statement to the pathway(s) it belongs to in
a merged network (see [4.8](#48-merged-network-handling-pathway-provenance)):

```turtle
okn:inPathway a owl:ObjectProperty ;
    rdfs:label "in pathway" ;
    rdfs:comment "The pathway(s) this reified interaction belongs to, derived from co-membership of its endpoints (both subject and object participate in the pathway)." ;
    rdfs:domain rdf:Statement ;
    rdfs:range biolink:Pathway .
```

### 4.5 Ontology Term Reference

#### Relations Ontology (RO) - Used Directly as Predicates

| Term | Label | Usage |
|------|-------|-------|
| `RO:0002436` | molecularly interacts with | Binding relationships |
| `RO:0002578` | directly regulates | PTM relationships (with GO typing) |
| `RO:0002629` | directly positively regulates | Activation, increase amount |
| `RO:0002630` | directly negatively regulates | Inhibition, decrease amount |
| `RO:0000056` | participates in | Protein → pathway membership (merged networks, see [4.8](#48-merged-network-handling-pathway-provenance)) |

#### Biolink Model & custom OKN terms (merged-network pathway provenance)

| Term | Label | Usage |
|------|-------|-------|
| `biolink:Pathway` | pathway | Type for pathway provenance nodes (`owl:equivalentClass PW:0000001`) |
| `okn:inPathway` | in pathway | Reified statement → pathway membership (heuristic, both endpoints participate) |

#### Gene Ontology (GO) - Used as Statement Types for PTMs

| Term | Label | Usage |
|------|-------|-------|
| `GO:0006468` | protein phosphorylation | Type for phosphorylation statements |
| `GO:0006470` | protein dephosphorylation | Type for dephosphorylation statements |
| `GO:0016567` | protein ubiquitination | Type for ubiquitination statements |
| `GO:0016579` | protein deubiquitination | Type for deubiquitination statements |
| `GO:0016925` | protein sumoylation | Type for sumoylation statements |
| `GO:0016926` | protein desumoylation | Type for desumoylation statements |

#### Semanticscience Integrated Ontology (SIO) - Entity Types

| Term | Label | Usage |
|------|-------|-------|
| `SIO:010043` | protein | Protein entities |

### 4.6 SPARQL Query Examples

#### Query all binding relationships
```sparql
SELECT ?protein1 ?protein2 WHERE {
    ?protein1 RO:0002436 ?protein2 .  # molecularly interacts with
}
```

#### Query all activation relationships with evidence
```sparql
SELECT ?subject ?object ?evidenceCount WHERE {
    ?stmt a rdf:Statement ;
          rdf:predicate RO:0002629 ;  # directly positively regulates
          rdf:subject ?subject ;
          rdf:object ?object ;
          okn:evidenceCount ?evidenceCount .
}
```

#### Query all phosphorylation events (PTM-specific)
```sparql
SELECT ?kinase ?substrate ?evidenceCount WHERE {
    ?stmt a GO:0006468 ;  # protein phosphorylation
          rdf:subject ?kinase ;
          rdf:object ?substrate ;
          okn:evidenceCount ?evidenceCount .
}
```

#### Query all PTM relationships (any type)
```sparql
SELECT ?subject ?object ?ptmType WHERE {
    ?stmt a rdf:Statement ;
          rdf:predicate RO:0002578 ;  # directly regulates
          rdf:subject ?subject ;
          rdf:object ?object ;
          a ?ptmType .
    FILTER(STRSTARTS(STR(?ptmType), "http://purl.obolibrary.org/obo/GO_"))
}
```

### 4.7 Benefits of Hybrid Standards-First Approach

**Zero Maintenance Overhead:**
- No custom predicates to maintain or document
- RO and GO terms are maintained by OBO Foundry communities
- Updates to ontologies don't require converter changes

**Immediate Interoperability:**
- Tools recognize RO predicates without reasoning
- Enables integration with other biological datasets using RO, GO, MI, MOD
- Supports federated SPARQL queries across knowledge graphs without inference

**Query Flexibility:**
Users can query at different levels of abstraction:
```sparql
# Direct queries work without reasoning
SELECT ?protein WHERE { ?protein RO:0002436 ?target }  # all binding

# Query all positive regulation (activation + increase amount)
SELECT ?protein WHERE { ?protein RO:0002629 ?target }

# Query specific PTMs via GO typing
SELECT ?kinase ?substrate WHERE { ?stmt a GO:0006468 ; rdf:subject ?kinase ; rdf:object ?substrate }

# Query all PTMs generically
SELECT ?subject ?object WHERE {
    ?stmt rdf:predicate RO:0002578 ; rdf:subject ?subject ; rdf:object ?object
}
```

**Standards Compliance:**
- Uses predicates directly from OBO Foundry ontologies
- Follows W3C RDF reification for metadata attachment
- Aligns with best practices in biomedical semantic web community

**Semantic Precision for PTMs:**
- GO biological process terms capture specific PTM types
- Reification pattern enables both generic and specific queries
- No loss of specificity compared to custom predicates

### 4.8 Merged Network Handling (Pathway Provenance)

Individual NCI-PID pathway networks can be merged into a single network (e.g. by `merge_cx2.py`,
optionally re-exported through Cytoscape) so that a gene shared by several pathways becomes one
node and redundant edges collapse. To preserve *which pathway each entity and interaction came
from*, the merge adds **pathway provenance nodes** (`type: "pathway"`) and **membership edges**
(`interaction: "participates in"`) from each pathway node to every protein that appeared in it.
This section defines how those are converted to RDF. It only *adds* triples — the protein/edge/
evidence conversion of §4.1–4.7 is unchanged, and networks without pathway nodes are unaffected.

#### 4.8.1 Pathway nodes

A pathway node carries only a name (and, in newer merges, an NDEx network UUID). Its CX2
`represents` value (e.g. `pathway:IL5-mediated signaling events _v2_0_`) is **not** a valid IRI
(spaces, non-resolvable scheme), so it is discarded. The name is first cleaned of a trailing
version marker left by the source filename (e.g. ` _v2_0_`), then the converter mints an IRI under
the graph namespace and types it with `biolink:Pathway`:

```turtle
pathway:IL5-mediated-signaling-events a biolink:Pathway ;
    rdfs:label "IL5-mediated signaling events" .
```

- **IRI:** `http://example.org/okn/pathway/<slug>` where `<slug>` is derived from the cleaned
  pathway name; when the pathway node carries an NDEx UUID, `<uuid>` is used instead for a stable
  identifier. Serialized with the dedicated `pathway:` prefix (= `…/okn/pathway/`) so it compacts
  (the trailing slash is not a valid CURIE local-name character under `okn:`).
- **Type:** `biolink:Pathway` (`owl:equivalentClass PW:0000001`).
- **Label:** the cleaned pathway name (version marker stripped).

#### 4.8.2 Node membership (`participates in`)

Each `participates in` edge runs pathway → protein and carries no `Relationships`/evidence. It is
emitted as a single **direct triple, flipped to protein-as-subject** (the Biolink-natural
direction), using `RO:0000056` (participates in). No reification is produced.

```turtle
uniprot:A0AVQ5 RO:0000056 pathway:IL5-mediated-signaling-events .   # LYN participates_in IL5
```

#### 4.8.3 Edge → pathway membership (`okn:inPathway`)

Because each interaction is already reified as an `rdf:Statement` node (§4.4), the pathway context
of an interaction can be attached directly to that node. The converter assigns a statement to a
pathway when **both** of its endpoints participate in that pathway:

> `statement(A,B) ∈ pathway P` ⟺ `A participates_in P` **and** `B participates_in P`

```turtle
okn:statement_582_0 a rdf:Statement ;
    rdf:subject uniprot:A8K1D9 ; rdf:predicate RO:0002629 ; rdf:object uniprot:A0AVQ5 ;
    okn:evidenceCount 6 ; okn:evidenceUrl <https://db.indra.bio/...> ;
    okn:inPathway pathway:IL5-mediated-signaling-events,
                  pathway:IL4-mediated-signaling-events .
```

Implementation: build a `proteinURI → {pathwayURI}` map from the membership edges, then for each
reified statement add `okn:inPathway` for every pathway in `pathways(subject) ∩ pathways(object)`.

**Caveat — this is an over-approximation, not curated provenance.** In a source pathway,
*edge A–B in P ⟹ A,B both in P* is always true, but the **converse is not**: A and B can both be
in P while their interaction was only curated in pathway Q. The merge collapses edges and drops
per-edge pathway provenance, and INDRA evidence URLs are identical across pathways, so edge
membership cannot be recovered exactly from the merged file alone. `okn:inPathway` therefore yields
a **superset** of true edge memberships (over-assigning for pathways that share both endpoints).
This is acceptable for pathway-scoped subgraph queries; the deliberately distinct, non-curated
predicate name signals that it is co-membership-derived. The exact alternative is to have the merge
record per-edge source pathways and emit them directly — a planned follow-up.

#### 4.8.4 Example pathway queries

```sparql
# Proteins participating in a pathway
SELECT ?protein WHERE { ?protein RO:0000056 pathway:IL5-mediated-signaling-events }

# All interactions (with evidence) belonging to a pathway
SELECT ?s ?p ?o ?evidence WHERE {
    ?stmt okn:inPathway pathway:IL5-mediated-signaling-events ;
          rdf:subject ?s ; rdf:predicate ?p ; rdf:object ?o ; okn:evidenceCount ?evidence .
}
```

## 5. Conversion Architecture

### 5.1 System Components

```
┌─────────────────┐
│  CX2 Parser     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Node Processor  │
│ - Extract nodes │
│ - Map to RDF    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Edge Processor  │
│ - Parse HTML    │
│ - Extract rels  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ RDF Generator   │
│ - Create triples│
│ - Turtle output │
└─────────────────┘
```

### 5.2 Processing Pipeline

#### Step 1: Parse CX2 JSON and Input Parameters
- Load JSON file as JSON array
- **Get network UUID** (optional): Accept as input parameter (e.g., from NDEx download metadata or command-line argument)
- Extract `attributeDeclarations` to understand aliases and defaults for node/edge attributes
- **Normalize attributes** (see [3.2.1](#321-attribute-declarations-aliases-and-defaults)): resolve each declared attribute's alias to its canonical full name and **apply declared defaults** to every `nodes`, `edges`, and `networkAttributes` element before conversion, so downstream steps read canonical names (`represents`, `name`, `interaction`) uniformly
- Extract `nodes` array (semantic data only)
- Extract `edges` array (semantic data only)
- Extract `networkAttributes` for metadata (name, description, version, reference)
- Clean HTML from `description` and trim to plain text
- Parse the primary reference URL from the `reference` HTML and use it as the reference URI
- Parse `networkAttributes.@context` JSON string and merge prefixes into the namespace declarations
- **Skip visual aspects**: Ignore `visualProperties`, `visualEditorProperties`, `nodeBypasses`, `edgeBypasses`
- **Skip spatial data**: Ignore node `x`, `y`, `z` coordinates

#### Step 2: Process Nodes
For each node (attributes already normalized to canonical full names in Step 1):
1. Get identifier from `represents` attribute
2. Parse identifier to extract namespace and ID (e.g., `uniprot:Q13547`)
3. Get entity type from `type` (declared default applied if the node omitted it)
4. Get display label from `name`
5. Create RDF entity with:
   - **If `type == "pathway"`** (merged-network provenance node, see [4.8.1](#481-pathway-nodes)):
     strip the version marker from `name`, mint `pathway:<slug|uuid>` (= `…/okn/pathway/<slug|uuid>`),
     type `biolink:Pathway`, label from the cleaned `name`; skip the `represents`/identifier logic
     above. Also record `proteinURI → {pathwayURI}` membership.
   - URI: Based on identifier namespace
   - Type: `rdf:type SIO:010043` (protein)
   - Label: `rdfs:label "HDAC1"`
   - Additional properties as needed

#### Step 3: Process Edges
For each edge:
1. Identify source and target nodes by ID, map to entity URIs
2. **If `interaction == "participates in"`** (pathway-membership edge, see [4.8.2](#482-node-membership-participates-in)):
   emit one direct triple `protein RO:0000056 pathway` (flip the pathway→protein direction so the
   protein is the subject), no reification, and continue to the next edge.
3. Parse HTML in `Relationships` attribute:
   - Extract total evidence count from "All Evidences" line
   - Extract individual relationship items from `<li/>` elements
3. Get edge-level metadata:
   - Source database(s) from `__edge_source` (e.g., "INDRA", "INDRA + NCI-PID")
   - **Ignore**: `interaction` (too generic), `__relationship_score` (redundant), `__directed`/`__reverse_directed`
4. For each relationship item parsed from HTML:
   - Parse subject, predicate, object from text (e.g., "PIAS1 sumoylates HDAC1")
   - Resolve subject/object to node URIs using the parsed names or evidence URL params
   - Extract evidence count and URL for this specific relationship
   - Use parsed subject/object order for the triple direction (A → B)
   - Generate:
     * **Direct triple**: `subject RO-predicate object` (e.g., `uniprot:O75928 RO:0002578 uniprot:Q13547`)
     * **Reified statement**: URI like `okn:e231_1` with:
       - Type: `rdf:Statement` (plus GO process type for PTMs, e.g., `GO:0016925`)
       - Properties: `rdf:subject`, `rdf:predicate`, `rdf:object`, `okn:evidenceCount`
       - Provenance: `dcterms:source`, `prov:wasDerivedFrom`
       - **Pathway membership** (merged networks, see [4.8.3](#483-edge--pathway-membership-okninpathway)):
         add `okn:inPathway <pathway>` for every pathway in
         `pathways(subject) ∩ pathways(object)`, using the `proteinURI → {pathwayURI}` map built
         in Step 2

#### Step 4: Generate RDF
- Write namespace declarations
- Write network-level metadata
- Write entity declarations (nodes)
- Write direct relationship triples (for easy querying)
- Write relation objects with metadata (for evidence tracking)
- Ensure proper formatting and syntax

## 6. Detailed Conversion Mapping

### 6.1 Node Conversion

**Input (CX2 Node):**
```json
{
  "id": 1,
  "x": 1190.0,
  "y": 1540.0,
  "v": {
    "n": "HDAC1",
    "r": "uniprot:Q13547",
    "type": "protein",
    "alias": ["uniprot:Q92534"]
  }
}
```

**Output (RDF Turtle):**
```turtle
uniprot:Q13547
    a SIO:010043 ;  # protein (Semanticscience Integrated Ontology)
    rdfs:label "HDAC1" ;
    skos:prefLabel "HDAC1" .
```

**Rationale:**
- Use the identifier from `represents` as the primary URI
- Type uses standard ontology (`SIO:010043` for protein)
- Display name as both rdfs:label and skos:prefLabel
- Skip aliases as requested

### 6.2 Simple Edge Conversion (Binding - Direct RO Predicate)

**Input (CX2 Edge - Simple Binding):**
```json
{
  "id": 227,
  "s": 13,
  "t": 15,
  "v": {
    "Relationships": "All Evidences (<a href=\"...\">32</a>)<ul><li/>PIAS1 binds UBE2I(<a href=\"...\">32</a>)</ul>",
    "__edge_source": "INDRA",
    "__relationship_score": 3.4657359027997265,  // IGNORED
    "__directed": false,
    "__reverse_directed": false,
    "i": "interacts with"  // IGNORED
  }
}
```

**Parsing Results:**
- Node 13 (source) → `uniprot:O75928` (PIAS1)
- Node 15 (target) → `uniprot:P63279` (UBE2I)
- Total evidence count: 32
- Relationship: "PIAS1 binds UBE2I" with 32 evidences

**Output (RDF Turtle):**
```turtle
# Direct triple using RO predicate (no custom predicate)
uniprot:O75928 RO:0002436 uniprot:P63279 .  # molecularly interacts with

# Reified statement for metadata
# URI pattern depends on whether network ID is provided (see Section 8.6)
# With network ID:    net:e227_1  (where net: = okn:n_{networkId}/)
# Without network ID: okn:e227_1
okn:e227_1 a rdf:Statement ;
    rdf:subject uniprot:O75928 ;
    rdf:predicate RO:0002436 ;
    rdf:object uniprot:P63279 ;
    okn:evidenceCount 32 ;
    dcterms:source "INDRA" ;
    prov:wasDerivedFrom <https://db.indra.bio/statements/from_agents?subject=PIAS1&object=UBE2I&type=Complex&format=html&expand_all=true> .
```

**Rationale:**
- Direct triple uses `RO:0002436` (molecularly interacts with) directly - no custom predicate
- Standard RDF reification pattern for metadata attachment
- Triple direction follows parsed relationship text (A → B)
- Statement URI includes network ID when provided for global uniqueness
- `__relationship_score` and `interaction` attributes are ignored

### 6.3 Complex Edge Conversion (PTMs - Reification with GO Types)

**Input (CX2 Edge - Multiple Relationships):**
```json
{
  "id": 231,
  "s": 1,
  "t": 15,
  "v": {
    "Relationships": "All Evidences (<a href=\"...\">13</a>)<ul><li/>PIAS1 sumoylates HDAC1(<a href=\"...\">8</a>)<li/>PIAS1 binds HDAC1(<a href=\"...\">3</a>)<li/>PIAS1 desumoylates HDAC1(<a href=\"...\">2</a>)</ul>",
    "__edge_source": "INDRA",
    "__relationship_score": 2.5649493574615367,  // IGNORED
    "__directed": false,
    "__reverse_directed": true,
    "i": "interacts with"  // IGNORED
  }
}
```

**Parsing Results:**
- Node 1 (source) → `uniprot:Q13547` (HDAC1)
- Node 15 (target) → `uniprot:O75928` (PIAS1)
- Total evidence count: 13
- Three relationships with individual evidence counts: 8, 3, 2
- `__reverse_directed: true` means relationships flow from target to source

**Output (RDF Turtle):**
```turtle
# Relationship 1: Sumoylation (8 evidences) - PTM uses RO:0002578 + GO type
uniprot:O75928 RO:0002578 uniprot:Q13547 .  # directly regulates

okn:e231_1 a rdf:Statement, GO:0016925 ;  # typed as "protein sumoylation"
    rdf:subject uniprot:O75928 ;
    rdf:predicate RO:0002578 ;
    rdf:object uniprot:Q13547 ;
    okn:evidenceCount 8 ;
    dcterms:source "INDRA" ;
    prov:wasDerivedFrom <https://db.indra.bio/statements/from_agents?subject=PIAS1&object=HDAC1&type=Sumoylation&format=html&expand_all=true> .

# Relationship 2: Binding (3 evidences) - uses RO:0002436 directly
uniprot:O75928 RO:0002436 uniprot:Q13547 .  # molecularly interacts with

okn:e231_2 a rdf:Statement ;
    rdf:subject uniprot:O75928 ;
    rdf:predicate RO:0002436 ;
    rdf:object uniprot:Q13547 ;
    okn:evidenceCount 3 ;
    dcterms:source "INDRA" ;
    prov:wasDerivedFrom <https://db.indra.bio/statements/from_agents?subject=PIAS1&object=HDAC1&type=Complex&format=html&expand_all=true> .

# Relationship 3: Desumoylation (2 evidences) - PTM uses RO:0002578 + GO type
uniprot:O75928 RO:0002578 uniprot:Q13547 .  # directly regulates (duplicate triple, no harm)

okn:e231_3 a rdf:Statement, GO:0016926 ;  # typed as "protein desumoylation"
    rdf:subject uniprot:O75928 ;
    rdf:predicate RO:0002578 ;
    rdf:object uniprot:Q13547 ;
    okn:evidenceCount 2 ;
    dcterms:source "INDRA" ;
    prov:wasDerivedFrom <https://db.indra.bio/statements/from_agents?subject=PIAS1&object=HDAC1&type=Desumoylation&format=html&expand_all=true> .
```

**Rationale:**
- **Binding** uses `RO:0002436` directly (standard predicate exists)
- **PTMs** (sumoylation, desumoylation) use `RO:0002578` (directly regulates) as the predicate
- PTM specificity captured via GO process type on the reified statement (e.g., `GO:0016925`)
- No custom predicates - all terms from RO and GO
- Direct triples enable simple queries; GO-typed statements enable PTM-specific queries
- All relationships follow the parsed A → B direction
- `__directed`/`__reverse_directed` are ignored; subject/object comes from the relationship text or evidence URL
- Total evidence across all relationships (13) can be calculated via SPARQL if needed

### 6.4 Network Metadata Conversion

**Input (CX2 Network Attributes + Optional UUID):**
```json
{
  "name": "Sumoylation by RanBP2 regulates transcriptional repression (v2.0)",
  "version": "2.0 (20220901)",
  "description": "<p>This is the updated version...</p>",
  "reference": "<p>Pillich RT, Chen J...</p>"
}
```
Plus optional UUID parameter: `e5c9f6a2-3b1d-11ed-a261-0ac135e8bacf` (from NDEx)

**Output (RDF Turtle with UUID):**
```turtle
okn:network_e5c9f6a2-3b1d-11ed-a261-0ac135e8bacf
    a SIO:000994 ;  # network (Semanticscience Integrated Ontology)
    dcterms:title "Sumoylation by RanBP2 regulates transcriptional repression (v2.0)" ;
    dcterms:description """This is the updated version of an original NCI Pathway
                           Interaction Database (PID) network...""" ;
    owl:versionInfo "2.0 (20220901)" ;
    dcterms:source <https://doi.org/10.1093/bioinformatics/btad118> ;
    dcterms:bibliographicCitation """Pillich RT, Chen J, Churas C, Fong D,
                                     Gyori BM, Ideker T, Karis K, Liu SN, Ono K,
                                     Pico A, Pratt D. NDEx IQuery...""" ;
    prov:wasDerivedFrom <https://www.ndexbio.org/v3/networks/e5c9f6a2-3b1d-11ed-a261-0ac135e8bacf> .
```

**Output (RDF Turtle without UUID):**
```turtle
okn:network_sumoylation_ranbp2
    a SIO:000994 ;  # network (Semanticscience Integrated Ontology)
    dcterms:title "Sumoylation by RanBP2 regulates transcriptional repression (v2.0)" ;
    dcterms:description """This is the updated version of an original NCI Pathway
                           Interaction Database (PID) network...""" ;
    owl:versionInfo "2.0 (20220901)" ;
    dcterms:source <https://doi.org/10.1093/bioinformatics/btad118> ;
    dcterms:bibliographicCitation """Pillich RT, Chen J, Churas C, Fong D,
                                     Gyori BM, Ideker T, Karis K, Liu SN, Ono K,
                                     Pico A, Pratt D. NDEx IQuery...""" ;
    prov:wasDerivedFrom <https://www.ndexbio.org/> .
```

**Logic:**
- **If UUID provided**: Use `https://www.ndexbio.org/v3/networks/{uuid}` and include UUID in network URI
- **If UUID missing**: Use `https://www.ndexbio.org/` and generate URI from network name
- `@context` is parsed for namespace declarations only; it is not emitted as a separate RDF literal
- `description` is HTML-stripped and trimmed to plain text before writing to RDF
- `reference` is parsed for the primary URL and written as a URI (e.g., `dcterms:source`)
- The plain text reference is retained as `dcterms:bibliographicCitation`

## 7. HTML Relationship Parsing Algorithm

### 7.1 Parsing Strategy

The parser uses a **two-tier approach** for robustness:

1. **Primary: Evidence URL Parameter Parsing** (Preferred)
   - INDRA evidence URLs contain structured query parameters: `subject`, `object`, `type`
   - These parameters are URL-encoded and handle all special characters reliably
   - Example: `?subject=NF-%CE%BAB&object=BCL-2&type=Activation`

2. **Fallback: Improved Text Parsing** (When URL parsing fails)
   - Used when evidence URL is missing or malformed
   - Uses predicate-aware parsing instead of simple regex

**Parsing Steps:**
1. **Extract list items**: Parse HTML to find all `<li/>` elements
2. **Extract evidence URL and count**: Parse href and text from anchor tag
3. **Parse URL parameters** (primary): Extract `subject`, `object`, `type` from URL query string
4. **Parse relationship text** (fallback): Use predicate-aware parsing if URL parsing fails
5. **Map type to predicate**: Convert INDRA type (e.g., "Ubiquitination") to predicate (e.g., "ubiquitinates")

### 7.2 Evidence URL Parameter Parsing (Primary Method)

INDRA evidence URLs contain structured data that is more reliable than text parsing:

**Input HTML:**
```html
<li/>MDM2 ubiquitinates HDAC1(<a href="https://db.indra.bio/statements/from_agents?subject=MDM2&object=HDAC1&type=Ubiquitination&format=html&expand_all=true" target="INDRA_Evidence">12</a>)
```

**URL Parameters:**
| Parameter | Value | Notes |
|-----------|-------|-------|
| `subject` | `MDM2` | URL-decoded subject entity |
| `object` | `HDAC1` | URL-decoded object entity |
| `type` | `Ubiquitination` | INDRA statement type |

**Parsed Components:**
- Subject: `MDM2` (from URL `subject` param)
- Predicate: `ubiquitinates` (mapped from URL `type` param)
- Object: `HDAC1` (from URL `object` param)
- Evidence Count: `12` (from anchor text)
- Evidence URL: `https://db.indra.bio/statements/...`

**Advantages of URL Parsing:**
- Handles special characters: `NF-κB`, `BCL-2`, `p53`, `IL-1β`
- No regex fragility
- URL encoding handles all edge cases
- INDRA maintains consistent URL structure

### 7.3 INDRA Statement Type to RDF Mapping

Map INDRA statement types (from URL `type` parameter) to RO predicates and GO statement types:

| INDRA Type | RO Predicate | Statement Type (GO) |
|------------|--------------|---------------------|
| `Complex` | `RO:0002436` (molecularly interacts with) | - |
| `Activation` | `RO:0002629` (directly positively regulates) | - |
| `Inhibition` | `RO:0002630` (directly negatively regulates) | - |
| `Phosphorylation` | `RO:0002578` (directly regulates) | `GO:0006468` (protein phosphorylation) |
| `Dephosphorylation` | `RO:0002578` (directly regulates) | `GO:0006470` (protein dephosphorylation) |
| `Ubiquitination` | `RO:0002578` (directly regulates) | `GO:0016567` (protein ubiquitination) |
| `Deubiquitination` | `RO:0002578` (directly regulates) | `GO:0016579` (protein deubiquitination) |
| `Sumoylation` | `RO:0002578` (directly regulates) | `GO:0016925` (protein sumoylation) |
| `Desumoylation` | `RO:0002578` (directly regulates) | `GO:0016926` (protein desumoylation) |
| `IncreaseAmount` | `RO:0002629` (directly positively regulates) | - |
| `DecreaseAmount` | `RO:0002630` (directly negatively regulates) | - |

**Note:** PTM types (phosphorylation, ubiquitination, etc.) use `RO:0002578` as the predicate with a GO process type on the reified statement to capture specificity.

### 7.4 Fallback Text Parsing (When URL Parsing Fails)

When evidence URLs are missing or malformed, use predicate-aware text parsing:

**Strategy: Known Predicate Matching**

Instead of fragile regex, match against a known list of predicates:

```typescript
const KNOWN_PREDICATES = [
  'binds',
  'activates',
  'inhibits',
  'phosphorylates',
  'dephosphorylates',
  'ubiquitinates',
  'deubiquitinates',
  'sumoylates',
  'desumoylates',
  'increases the amount of',
  'decreases the amount of',
];

// Sort by length (longest first) to match multi-word predicates before single-word
const sortedPredicates = KNOWN_PREDICATES.sort((a, b) => b.length - a.length);
```

**Parsing Algorithm:**
1. For each known predicate (longest first):
   - Search for predicate in text (case-insensitive)
   - If found, split text into subject (before) and object (after)
   - Handle parenthetical suffix for evidence count
2. If no known predicate matches, log warning and skip relationship

**Example - Complex Protein Names:**
```
Input: "NF-κB activates BCL-2(5)"

1. Search for "increases the amount of" → not found
2. Search for "decreases the amount of" → not found
3. Search for "activates" → found at position 6
4. Subject = "NF-κB" (text before "activates", trimmed)
5. Object = "BCL-2" (text after "activates", before "(", trimmed)
6. Result: { subject: "NF-κB", predicate: "activates", object: "BCL-2" }
```

### 7.5 Predicate Normalization

Normalize parsed predicates to camelCase for RDF:

| Raw Text | Normalized Predicate |
|----------|---------------------|
| `"increases the amount of"` | `increasesAmountOf` |
| `"decreases the amount of"` | `decreasesAmountOf` |
| `"binds"` | `binds` |
| `"activates"` | `activates` |

### 7.6 Edge Cases and Error Handling

| Scenario | Handling |
|----------|----------|
| Missing evidence URL | Use fallback text parsing |
| Malformed URL (no query params) | Use fallback text parsing |
| Unknown predicate in text | Log warning, skip relationship |
| Special characters in names | URL parsing handles automatically; fallback uses string search |
| Empty relationship list | Return empty array |
| Missing evidence count | Default to 0 |

## 8. Implementation Considerations

### 8.1 Identifier Resolution

**Challenge**: Node IDs in CX2 are internal integers; need to map to actual entity identifiers.

**Solution**:
```typescript
// Build lookup table during node processing
const nodeIdToUri = new Map<number, string>();

for (const node of cx2Nodes) {
  const nodeId = node.id;
  const represents = node.v.r;  // e.g., "uniprot:Q13547"
  const uri = resolveIdentifier(represents);
  nodeIdToUri.set(nodeId, uri);
}

// Use during edge processing
const sourceUri = nodeIdToUri.get(edge.s);
const targetUri = nodeIdToUri.get(edge.t);
```

### 8.2 URI Construction

Parse identifier strings like `uniprot:Q13547`:
- Namespace: `uniprot`
- ID: `Q13547`
- URI: `http://purl.uniprot.org/uniprot/Q13547`

Handle various namespace formats:
- `uniprot:*` → UniProt URIs
- `hgnc:*` → HGNC gene identifiers
- Custom identifiers → Use okn namespace

### 8.3 Network UUID Handling

**Challenge**: Network UUID is not embedded in CX2 file; needed for proper provenance tracking.

**Sources for UUID**:
1. **NDEx API download metadata**: When downloading via NDEx API, UUID is in response
2. **NDEx URL**: Extract from URL like `https://www.ndexbio.org/viewer/networks/{uuid}`
3. **Filename**: Sometimes encoded in filename (e.g., `network_{uuid}.cx2`)
4. **Command-line parameter**: User provides as argument

**Implementation**:
```typescript
function buildNetworkProvenance(uuid?: string): string {
  if (uuid) {
    return `https://www.ndexbio.org/v3/networks/${uuid}`;
  }
  return 'https://www.ndexbio.org/';
}
```

### 8.4 Directionality Handling

Ignore `__directed` and `__reverse_directed`. Directionality comes from each parsed relationship item:

1. Parse subject/predicate/object from the `<li/>` text.
2. Resolve subject/object to node URIs (prefer evidence URL `subject`/`object` params when available).
3. Emit `subject predicate object` as the triple (A → B).

All predicates are treated as directed relationships, and the emitted triple always follows the parsed A → B direction.

### 8.5 Evidence Source Handling

Map `__edge_source` values to provenance:
- `"INDRA"` → `prov:wasDerivedFrom <https://db.indra.bio/>`
- `"INDRA + NCI-PID"` → Multiple provenance statements

```turtle
:relationship_X
    dcterms:source "INDRA", "NCI-PID" ;
    prov:wasDerivedFrom <https://db.indra.bio/>,
                        <https://www.ndexbio.org/> .
```

### 8.6 Network Scope and Statement URI Construction

Statement URIs are constructed based on whether a **network ID** parameter is provided:

**With Network ID (recommended for multi-network scenarios):**
```turtle
# Pattern: okn:n_{networkId}/e{edgeId}_{index}
okn:n_e5c9f6a2-3b1d-11ed-a261-0ac135e8bacf/e231_1
```

**Without Network ID (simple single-network use):**
```turtle
# Pattern: okn:e{edgeId}_{index}
okn:e231_1
```

**URI Construction Logic:**
```typescript
function buildStatementUri(edgeId: number, index: number, networkId?: string): string {
  if (networkId) {
    return `okn:n_${networkId}/e${edgeId}_${index}`;
  }
  return `okn:e${edgeId}_${index}`;
}
```

**Guidance:**
- For **single network exports** or quick conversions: network ID is optional
- For **loading multiple networks into the same triplestore**: always provide network ID to prevent URI collisions
- The network ID can be the NDEx UUID, a user-defined identifier, or any unique string

## 9. Software Architecture

### 9.1 Module Structure

```
cx2-to-rdf-converter/
├── src/
│   ├── parser/
│   │   ├── cx2-parser.ts          # Parse CX2 JSON
│   │   └── html-parser.ts         # Parse relationship HTML
│   ├── processor/
│   │   ├── node-processor.ts      # Process nodes to RDF
│   │   ├── edge-processor.ts      # Process edges to RDF
│   │   └── metadata-processor.ts  # Process network metadata
│   ├── models/
│   │   ├── entity.ts              # Entity data model
│   │   ├── relationship.ts        # Relationship data model
│   │   └── network.ts             # Network metadata model
│   ├── rdf/
│   │   ├── namespace.ts           # Namespace management
│   │   ├── uri-builder.ts         # URI construction
│   │   └── turtle-writer.ts       # Turtle serialization
│   ├── config/
│   │   ├── namespaces.ts          # Namespace mappings
│   │   └── predicates.ts          # Predicate mappings
│   ├── types/
│   │   └── index.ts               # TypeScript type definitions
│   └── converter.ts               # Main converter orchestrator
├── tests/
│   ├── parser.test.ts
│   ├── processor.test.ts
│   └── integration.test.ts
├── examples/
│   ├── small_example.cx2
│   └── small_example.ttl
├── package.json
├── tsconfig.json
└── README.md
```

**Key Dependencies** (package.json):
```json
{
  "dependencies": {
    "rdflib": "^2.2.x",           // RDF library for JavaScript/TypeScript
    "n3": "^1.17.x",              // Alternative: N3 library for RDF
    "uuid": "^9.0.x"              // UUID validation/parsing
  },
  "devDependencies": {
    "@types/node": "^20.x.x",
    "typescript": "^5.x.x",
    "vitest": "^1.x.x"            // Testing framework
  }
}
```

### 9.2 Key Classes and Interfaces

#### Type Definitions
```typescript
// src/types/index.ts

export interface CX2Data {
  attributeDeclarations: AttributeDeclaration[];
  networkAttributes: NetworkAttribute[];
  nodes: CX2Node[];
  edges: CX2Edge[];
}

export interface CX2Node {
  id: number;
  x?: number;
  y?: number;
  v: {
    n: string;          // name (aliased)
    r: string;          // represents (aliased)
    type?: string;
    alias?: string[];
  };
}

export interface CX2Edge {
  id: number;
  s: number;            // source node ID
  t: number;            // target node ID
  v: {
    Relationships: string;        // HTML string
    __edge_source: string;        // "INDRA" | "INDRA + NCI-PID"
    __directed: boolean;
    __reverse_directed: boolean;
    i?: string;                   // interaction (ignored)
    __relationship_score?: number; // ignored
  };
}

export interface ConversionConfig {
  namespaces: Record<string, string>;
  predicates: Record<string, PredicateConfig>;
}

export interface PredicateConfig {
  uri: string;
  symmetric: boolean;
  directed: boolean;
}
```

#### Converter
```typescript
// src/converter.ts
import { CX2Parser } from './parser/cx2-parser';
import { HTMLParser } from './parser/html-parser';
import { NodeProcessor } from './processor/node-processor';
import { EdgeProcessor } from './processor/edge-processor';
import { MetadataProcessor } from './processor/metadata-processor';
import { TurtleWriter } from './rdf/turtle-writer';
import type { CX2Data, ConversionConfig } from './types';

export class CX2ToRDFConverter {
  private parser: CX2Parser;
  private htmlParser: HTMLParser;
  private nodeProcessor: NodeProcessor;
  private edgeProcessor: EdgeProcessor;
  private metadataProcessor: MetadataProcessor;
  private rdfWriter: TurtleWriter;

  constructor(config: ConversionConfig) {
    this.parser = new CX2Parser();
    this.htmlParser = new HTMLParser();
    this.nodeProcessor = new NodeProcessor(config);
    this.edgeProcessor = new EdgeProcessor(config, this.htmlParser);
    this.metadataProcessor = new MetadataProcessor(config);
    this.rdfWriter = new TurtleWriter(config);
  }

  /**
   * Convert CX2 file to RDF Turtle format
   * @param cx2File - CX2 JSON string or File object
   * @param networkUuid - Optional NDEx network UUID
   * @returns Turtle-formatted RDF string
   */
  async convert(
    cx2File: string | File,
    networkUuid?: string
  ): Promise<string> {
    // Parse CX2
    const cx2Data = await this.parser.parse(cx2File);

    // Process network metadata
    const networkMetadata = this.metadataProcessor.process(
      cx2Data.networkAttributes,
      networkUuid
    );

    // Process nodes
    const entities = this.nodeProcessor.process(cx2Data.nodes);

    // Process edges
    const relationships = await this.edgeProcessor.process(
      cx2Data.edges,
      entities
    );

    // Write RDF
    return this.rdfWriter.write(
      networkMetadata,
      entities,
      relationships
    );
  }

  /**
   * Convert CX2 file and download as .ttl file (browser only)
   */
  async convertAndDownload(
    cx2File: string | File,
    outputFilename: string,
    networkUuid?: string
  ): Promise<void> {
    const turtle = await this.convert(cx2File, networkUuid);

    // Create blob and download
    const blob = new Blob([turtle], { type: 'text/turtle' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = outputFilename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
```

#### HTMLRelationshipParser
```typescript
// src/parser/html-parser.ts

export interface ParsedRelationship {
  subject: string;
  predicate: string;
  object: string;
  evidenceCount: number;
  evidenceUrl: string;
}

/**
 * Known predicates for fallback text parsing.
 * Sorted by length (longest first) to match multi-word predicates before single-word.
 */
const KNOWN_PREDICATES = [
  'increases the amount of',
  'decreases the amount of',
  'dephosphorylates',
  'deubiquitinates',
  'phosphorylates',
  'ubiquitinates',
  'desumoylates',
  'sumoylates',
  'activates',
  'inhibits',
  'binds',
];

/**
 * Map INDRA statement types to RDF predicates.
 */
const INDRA_TYPE_TO_PREDICATE: Record<string, string> = {
  'Complex': 'binds',
  'Activation': 'activates',
  'Inhibition': 'inhibits',
  'Phosphorylation': 'phosphorylates',
  'Dephosphorylation': 'dephosphorylates',
  'Ubiquitination': 'ubiquitinates',
  'Deubiquitination': 'deubiquitinates',
  'Sumoylation': 'sumoylates',
  'Desumoylation': 'desumoylates',
  'IncreaseAmount': 'increasesAmountOf',
  'DecreaseAmount': 'decreasesAmountOf',
};

export class HTMLParser {
  /**
   * Parse HTML relationship list into structured data.
   * Uses two-tier approach: URL parameter parsing (primary) with text parsing fallback.
   * @param htmlString - HTML string from Relationships attribute
   * @returns Array of parsed relationships
   */
  parse(htmlString: string): ParsedRelationship[] {
    const parser = typeof DOMParser !== 'undefined'
      ? new DOMParser()
      : this.getNodeDOMParser();

    const doc = parser.parseFromString(htmlString, 'text/html');
    const relationships: ParsedRelationship[] = [];

    const listItems = doc.querySelectorAll('li');

    for (const li of listItems) {
      const text = li.textContent || '';
      const link = li.querySelector('a');

      if (!link) continue;

      const evidenceCount = parseInt(link.textContent || '0', 10);
      const evidenceUrl = link.getAttribute('href') || '';

      // Primary: Try to parse from URL parameters
      let parsed = this.parseFromUrl(evidenceUrl);

      // Fallback: Parse from text if URL parsing fails
      if (!parsed) {
        parsed = this.parseFromText(text);
      }

      if (parsed) {
        relationships.push({
          subject: parsed.subject,
          predicate: this.normalizePredicate(parsed.predicate),
          object: parsed.object,
          evidenceCount,
          evidenceUrl,
        });
      } else {
        console.warn(`Failed to parse relationship: "${text}"`);
      }
    }

    return relationships;
  }

  /**
   * Parse relationship from INDRA evidence URL parameters (primary method).
   * Handles special characters reliably via URL encoding.
   */
  private parseFromUrl(url: string): { subject: string; predicate: string; object: string } | null {
    try {
      const urlObj = new URL(url);
      const subject = urlObj.searchParams.get('subject');
      const object = urlObj.searchParams.get('object');
      const type = urlObj.searchParams.get('type');

      if (!subject || !object || !type) {
        return null;
      }

      const predicate = INDRA_TYPE_TO_PREDICATE[type];
      if (!predicate) {
        console.warn(`Unknown INDRA type: "${type}"`);
        return null;
      }

      return { subject, predicate, object };
    } catch {
      // Invalid URL, fall back to text parsing
      return null;
    }
  }

  /**
   * Parse relationship from text using known predicate matching (fallback method).
   * Handles protein names with hyphens, numbers, and special characters.
   */
  private parseFromText(text: string): { subject: string; predicate: string; object: string } | null {
    const lowerText = text.toLowerCase();

    for (const predicate of KNOWN_PREDICATES) {
      const predicateIndex = lowerText.indexOf(predicate);
      if (predicateIndex === -1) continue;

      // Extract subject (before predicate)
      const subjectPart = text.substring(0, predicateIndex).trim();

      // Extract object (after predicate, before parenthesis)
      const afterPredicate = text.substring(predicateIndex + predicate.length);
      const parenIndex = afterPredicate.indexOf('(');
      const objectPart = parenIndex !== -1
        ? afterPredicate.substring(0, parenIndex).trim()
        : afterPredicate.trim();

      if (subjectPart && objectPart) {
        return {
          subject: subjectPart,
          predicate: predicate,
          object: objectPart,
        };
      }
    }

    return null;
  }

  /**
   * Extract total evidence count from "All Evidences" line
   */
  parseTotalEvidenceCount(htmlString: string): number {
    const match = htmlString.match(/All Evidences[^>]*>(\d+)</);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * Normalize predicate text to camelCase
   */
  private normalizePredicate(predicate: string): string {
    const trimmed = predicate.trim().toLowerCase();

    const normalizationMap: Record<string, string> = {
      'increases the amount of': 'increasesAmountOf',
      'decreases the amount of': 'decreasesAmountOf',
    };

    return normalizationMap[trimmed] || trimmed;
  }

  /**
   * Get DOM parser for Node.js environment (requires jsdom)
   */
  private getNodeDOMParser(): DOMParser {
    if (typeof window === 'undefined') {
      const { JSDOM } = require('jsdom');
      const dom = new JSDOM();
      return new dom.window.DOMParser();
    }
    throw new Error('DOMParser not available');
  }
}
```

## 10. Configuration Files

### 10.1 Namespace Configuration

```typescript
// src/config/namespaces.ts

export const NAMESPACES = {
  // Core namespace (for statements and network-specific entities only)
  okn: 'http://purl.org/okn/',

  // Entity identifiers
  uniprot: 'http://purl.uniprot.org/uniprot/',
  hgnc: 'http://identifiers.org/hgnc/',

  // RDF/OWL standard namespaces
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  owl: 'http://www.w3.org/2002/07/owl#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',

  // Metadata and provenance
  dcterms: 'http://purl.org/dc/terms/',
  prov: 'http://www.w3.org/ns/prov#',
  skos: 'http://www.w3.org/2004/02/skos/core#',

  // Standard biological ontologies (used for predicates and entity types)
  RO: 'http://purl.obolibrary.org/obo/RO_',
  GO: 'http://purl.obolibrary.org/obo/GO_',
  SO: 'http://purl.obolibrary.org/obo/SO_',
  CHEBI: 'http://purl.obolibrary.org/obo/CHEBI_',
  MONDO: 'http://purl.obolibrary.org/obo/MONDO_',
  UPHENO: 'http://purl.obolibrary.org/obo/UPHENO_',
  PW: 'http://purl.obolibrary.org/obo/PW_',
  UBERON: 'http://purl.obolibrary.org/obo/UBERON_',
  NCIT: 'http://purl.obolibrary.org/obo/NCIT_',
  SIO: 'http://semanticscience.org/resource/SIO_',
} as const;

/**
 * Merge CX2 @context prefixes into the namespace map.
 * @context is a stringified JSON object (prefix -> URI).
 * If a prefix exists in both, prefer the CX2 @context value.
 */
export function mergeContextNamespaces(
  namespaces: Record<string, string>,
  contextJson?: string
): Record<string, string> {
  if (!contextJson) {
    return { ...namespaces };
  }
  const context = JSON.parse(contextJson);
  return { ...namespaces, ...context };
}

export const IDENTIFIER_MAPPINGS: Record<string, string> = {
  uniprot: 'http://purl.uniprot.org/uniprot/{id}',
  hgnc: 'http://identifiers.org/hgnc/{id}',
  default: 'http://purl.org/okn/entity/{id}',
};

/**
 * Resolve identifier to full URI
 */
export function resolveIdentifier(identifier: string): string {
  const [namespace, id] = identifier.split(':');
  const template = IDENTIFIER_MAPPINGS[namespace] || IDENTIFIER_MAPPINGS.default;
  return template.replace('{id}', id || identifier);
}
```

### 10.2 Relationship Type Configuration

```typescript
// src/config/relationships.ts

/**
 * Configuration for mapping relationship types to RO predicates and GO statement types.
 * Uses standard ontology terms directly (no custom predicates).
 */
export interface RelationshipConfig {
  /** RO predicate URI */
  predicate: string;
  /** GO process type for reified statement (null for non-PTM relationships) */
  statementType: string | null;
  /** Whether the relationship is directed */
  directed: boolean;
}

export const RELATIONSHIP_TYPES: Record<string, RelationshipConfig> = {
  // Binding - uses RO directly
  binds: {
    predicate: 'RO:0002436',  // molecularly interacts with
    statementType: null,
    directed: true,
  },

  // Activation and inhibition - use RO directly
  activates: {
    predicate: 'RO:0002629',  // directly positively regulates
    statementType: null,
    directed: true,
  },

  inhibits: {
    predicate: 'RO:0002630',  // directly negatively regulates
    statementType: null,
    directed: true,
  },

  // PTMs - use RO:0002578 with GO process types
  phosphorylates: {
    predicate: 'RO:0002578',  // directly regulates
    statementType: 'GO:0006468',  // protein phosphorylation
    directed: true,
  },

  dephosphorylates: {
    predicate: 'RO:0002578',
    statementType: 'GO:0006470',  // protein dephosphorylation
    directed: true,
  },

  ubiquitinates: {
    predicate: 'RO:0002578',
    statementType: 'GO:0016567',  // protein ubiquitination
    directed: true,
  },

  deubiquitinates: {
    predicate: 'RO:0002578',
    statementType: 'GO:0016579',  // protein deubiquitination
    directed: true,
  },

  sumoylates: {
    predicate: 'RO:0002578',
    statementType: 'GO:0016925',  // protein sumoylation
    directed: true,
  },

  desumoylates: {
    predicate: 'RO:0002578',
    statementType: 'GO:0016926',  // protein desumoylation
    directed: true,
  },

  // Abundance changes - use RO directly
  increasesAmountOf: {
    predicate: 'RO:0002629',  // directly positively regulates
    statementType: null,
    directed: true,
  },

  decreasesAmountOf: {
    predicate: 'RO:0002630',  // directly negatively regulates
    statementType: null,
    directed: true,
  },
};

/**
 * Get relationship configuration for a predicate
 */
export function getRelationshipConfig(predicate: string): RelationshipConfig | undefined {
  return RELATIONSHIP_TYPES[predicate];
}

/**
 * Map INDRA type to internal predicate name
 */
export const INDRA_TYPE_MAP: Record<string, string> = {
  'Complex': 'binds',
  'Activation': 'activates',
  'Inhibition': 'inhibits',
  'Phosphorylation': 'phosphorylates',
  'Dephosphorylation': 'dephosphorylates',
  'Ubiquitination': 'ubiquitinates',
  'Deubiquitination': 'deubiquitinates',
  'Sumoylation': 'sumoylates',
  'Desumoylation': 'desumoylates',
  'IncreaseAmount': 'increasesAmountOf',
  'DecreaseAmount': 'decreasesAmountOf',
};
```

### 10.3 React Integration Example

For use in a React application:

```typescript
// src/hooks/useCX2Converter.ts
import { useState } from 'react';
import { CX2ToRDFConverter } from '../converter';
import { NAMESPACES } from '../config/namespaces';
import { RELATIONSHIP_TYPES } from '../config/relationships';

export function useCX2Converter() {
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const converter = new CX2ToRDFConverter({
    namespaces: NAMESPACES,
    relationshipTypes: RELATIONSHIP_TYPES,
  });

  const convertFile = async (
    file: File,
    networkUuid?: string
  ): Promise<string | null> => {
    setIsConverting(true);
    setError(null);

    try {
      const turtle = await converter.convert(file, networkUuid);
      return turtle;
    } catch (err) {
      setError(err as Error);
      return null;
    } finally {
      setIsConverting(false);
    }
  };

  const convertAndDownload = async (
    file: File,
    outputFilename: string,
    networkUuid?: string
  ): Promise<void> => {
    setIsConverting(true);
    setError(null);

    try {
      await converter.convertAndDownload(file, outputFilename, networkUuid);
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsConverting(false);
    }
  };

  return {
    convertFile,
    convertAndDownload,
    isConverting,
    error,
  };
}
```

```typescript
// Example React component
import React from 'react';
import { useCX2Converter } from './hooks/useCX2Converter';

export function CX2ConverterComponent() {
  const { convertAndDownload, isConverting, error } = useCX2Converter();
  const [networkUuid, setNetworkUuid] = React.useState('');

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const outputFilename = file.name.replace('.cx2', '.ttl');
    await convertAndDownload(file, outputFilename, networkUuid || undefined);
  };

  return (
    <div>
      <h2>CX2 to RDF Converter</h2>

      <div>
        <label>
          Network UUID (optional):
          <input
            type="text"
            value={networkUuid}
            onChange={(e) => setNetworkUuid(e.target.value)}
            placeholder="e.g., e5c9f6a2-3b1d-11ed-a261-0ac135e8bacf"
          />
        </label>
      </div>

      <div>
        <label>
          Select CX2 File:
          <input
            type="file"
            accept=".cx2,.json"
            onChange={handleFileUpload}
            disabled={isConverting}
          />
        </label>
      </div>

      {isConverting && <p>Converting...</p>}
      {error && <p style={{ color: 'red' }}>Error: {error.message}</p>}
    </div>
  );
}
```

## 11. Example Output

### 11.1 Complete Example

**Input:** Small network with 3 nodes and 2 edges
**Network ID:** `e5c9f6a2-3b1d-11ed-a261-0ac135e8bacf` (optional parameter)

**Output (Turtle):**
```turtle
@prefix okn: <http://purl.org/okn/> .
@prefix net: <http://purl.org/okn/n_e5c9f6a2-3b1d-11ed-a261-0ac135e8bacf/> .
@prefix uniprot: <http://purl.uniprot.org/uniprot/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix sio: <http://semanticscience.org/resource/> .
@prefix RO: <http://purl.obolibrary.org/obo/RO_> .
@prefix GO: <http://purl.obolibrary.org/obo/GO_> .

# ========================================
# Network metadata
# ========================================
okn:n_e5c9f6a2-3b1d-11ed-a261-0ac135e8bacf
    a sio:SIO_000994 ;  # network
    dcterms:title "Sumoylation by RanBP2 regulates transcriptional repression (v2.0)" ;
    owl:versionInfo "2.0 (20220901)" ;
    dcterms:description """This is the updated version of an original NCI Pathway
                           Interaction Database (PID) network.""" ;
    prov:wasDerivedFrom <https://www.ndexbio.org/v3/networks/e5c9f6a2-3b1d-11ed-a261-0ac135e8bacf> .

# ========================================
# Entity declarations (using SIO for types)
# ========================================
uniprot:Q13547
    a sio:SIO_010043 ;  # protein
    rdfs:label "HDAC1" ;
    skos:prefLabel "HDAC1" .

uniprot:O75928
    a sio:SIO_010043 ;  # protein
    rdfs:label "PIAS1" ;
    skos:prefLabel "PIAS1" .

uniprot:P63279
    a sio:SIO_010043 ;  # protein
    rdfs:label "UBE2I" ;
    skos:prefLabel "UBE2I" .

# ========================================
# Relationships - Direct triples using RO predicates
# ========================================
# Binding relationships use RO:0002436 (molecularly interacts with)
uniprot:O75928 RO:0002436 uniprot:P63279 .  # PIAS1 binds UBE2I
uniprot:O75928 RO:0002436 uniprot:Q13547 .  # PIAS1 binds HDAC1

# PTM relationships use RO:0002578 (directly regulates)
uniprot:O75928 RO:0002578 uniprot:Q13547 .  # PIAS1 sumoylates HDAC1

# ========================================
# Reified statements with metadata
# (URIs use network-specific namespace for global uniqueness)
# ========================================

# Binding: PIAS1 binds UBE2I (32 evidences)
net:e227_1 a rdf:Statement ;
    rdf:subject uniprot:O75928 ;
    rdf:predicate RO:0002436 ;
    rdf:object uniprot:P63279 ;
    okn:evidenceCount 32 ;
    dcterms:source "INDRA" ;
    prov:wasDerivedFrom <https://db.indra.bio/statements/from_agents?subject=PIAS1&object=UBE2I&type=Complex&format=html&expand_all=true> .

# PTM: PIAS1 sumoylates HDAC1 (8 evidences) - typed with GO process
net:e231_1 a rdf:Statement, GO:0016925 ;  # protein sumoylation
    rdf:subject uniprot:O75928 ;
    rdf:predicate RO:0002578 ;
    rdf:object uniprot:Q13547 ;
    okn:evidenceCount 8 ;
    dcterms:source "INDRA" ;
    prov:wasDerivedFrom <https://db.indra.bio/statements/from_agents?subject=PIAS1&object=HDAC1&type=Sumoylation&format=html&expand_all=true> .

# Binding: PIAS1 binds HDAC1 (3 evidences)
net:e231_2 a rdf:Statement ;
    rdf:subject uniprot:O75928 ;
    rdf:predicate RO:0002436 ;
    rdf:object uniprot:Q13547 ;
    okn:evidenceCount 3 ;
    dcterms:source "INDRA" ;
    prov:wasDerivedFrom <https://db.indra.bio/statements/from_agents?subject=PIAS1&object=HDAC1&type=Complex&format=html&expand_all=true> .
```

**Key features of this output:**
- **No custom predicates** - uses RO predicates directly (`RO:0002436`, `RO:0002578`)
- **Standard entity types** - uses SIO ontology (`sio:SIO_010043` for protein)
- **PTM specificity via GO types** - sumoylation statement typed with `GO:0016925`
- **Standard reification** - uses `rdf:Statement` with standard properties
- **Network-scoped statement URIs** - `net:e231_1` expands to globally unique URI
- **Minimal custom vocabulary** - only `okn:evidenceCount` for metadata

**Note:** If no network ID is provided, statement URIs would use `okn:e231_1` instead (see Section 8.6).

## 12. Testing Strategy

### 12.1 Unit Tests

- **Parser Tests**: Verify CX2 JSON parsing
- **HTML Parser Tests**: Verify relationship extraction from various HTML patterns
- **Processor Tests**: Verify correct RDF triple generation
- **URI Builder Tests**: Verify correct URI construction for various namespaces

### 12.2 Integration Tests

- **Full Conversion Test**: Convert sample CX2 files and verify output structure
- **SPARQL Query Tests**: Load generated RDF into triplestore and verify queryability
- **Validation Tests**: Validate generated Turtle syntax

### 12.3 Sample Queries

After conversion, users should be able to query using standard RO predicates:

```sparql
# Query 1: Find all proteins that PIAS1 binds (using RO directly)
SELECT ?protein ?label WHERE {
    uniprot:O75928 RO:0002436 ?protein .  # molecularly interacts with
    ?protein rdfs:label ?label .
}

# Query 2: Find all activation relationships with high evidence counts
SELECT ?subject ?object ?evidenceCount WHERE {
    ?stmt a rdf:Statement ;
          rdf:predicate RO:0002629 ;  # directly positively regulates
          rdf:subject ?subject ;
          rdf:object ?object ;
          okn:evidenceCount ?evidenceCount .
    FILTER(?evidenceCount > 10)
}

# Query 3: Find proteins involved in sumoylation (using GO process type)
SELECT DISTINCT ?protein WHERE {
    ?stmt a GO:0016925 ;  # protein sumoylation
          rdf:subject ?protein .
}
UNION
SELECT DISTINCT ?protein WHERE {
    ?stmt a GO:0016925 ;
          rdf:object ?protein .
}

# Query 4: Calculate total evidence count for a protein pair
SELECT ?protein1 ?protein2 (SUM(?count) as ?totalEvidence) WHERE {
    ?stmt a rdf:Statement ;
          rdf:subject ?protein1 ;
          rdf:object ?protein2 ;
          okn:evidenceCount ?count .
}
GROUP BY ?protein1 ?protein2

# Query 5: Find all PTM relationships with evidence sources
SELECT ?stmt ?ptmType ?subject ?object ?source ?evidenceCount WHERE {
    ?stmt a rdf:Statement ;
          rdf:predicate RO:0002578 ;  # directly regulates (PTMs)
          rdf:subject ?subject ;
          rdf:object ?object ;
          dcterms:source ?source ;
          okn:evidenceCount ?evidenceCount ;
          a ?ptmType .
    FILTER(STRSTARTS(STR(?ptmType), "http://purl.obolibrary.org/obo/GO_"))
}

# Query 6: Find binding partners with evidence
SELECT ?partner ?evidenceCount WHERE {
    uniprot:O75928 RO:0002436 ?partner .  # molecularly interacts with
    ?stmt a rdf:Statement ;
          rdf:predicate RO:0002436 ;
          rdf:subject uniprot:O75928 ;
          rdf:object ?partner ;
          okn:evidenceCount ?evidenceCount .
}
```

## 13. Edge Cases and Considerations

### 13.1 Missing Node Attributes

- If `type` is missing, use default from `attributeDeclarations`
- If `represents` is missing, generate URI from node ID
- If `name` is missing, use identifier as label

### 13.2 Malformed HTML

- Handle HTML without proper list structure
- Handle missing anchor tags
- Log warnings for unparseable relationships

### 13.3 Custom Entity Types

- Support non-protein entities (chemicals, complexes, etc.)
- Map types to appropriate ontology classes
- Handle unknown types gracefully

### 13.4 Identifier Resolution

- Handle various identifier formats (with/without namespace prefix)
- Support multiple namespace conventions
- Provide fallback to custom namespace

### 13.5 Large Files

- Stream processing for large CX2 files
- Chunked RDF output
- Progress reporting

## 14. Performance Considerations

### 14.1 Optimization Strategies

- **Lazy Parsing**: Parse HTML only when needed
- **Caching**: Cache node ID to URI mappings
- **Batch Processing**: Process nodes and edges in batches
- **Streaming**: Stream RDF output instead of building in memory

### 14.2 Scalability

Expected performance for sample files:
- Small (16 nodes, 58 edges): < 1 second
- Medium (100s of nodes): < 5 seconds
- Large (1000s of nodes): < 60 seconds

## 15. Dataset Adapter Architecture

### 15.1 Overview

The **bio-cx2-to-rdf** converter uses a **dataset-specific adapter pattern** to support multiple biological network datasets. Each dataset (NCI-PID 2.0, Nest Hierarchy, etc.) has its own adapter that implements dataset-specific conversion logic while sharing a common core infrastructure.

### 15.2 Adapter Interface

All dataset adapters implement the `DatasetAdapter` interface:

```typescript
export interface DatasetAdapter {
  /** Unique identifier for this dataset */
  readonly datasetId: string;

  /** Human-readable name */
  readonly datasetName: string;

  /** Detect if a CX2 network belongs to this dataset */
  canHandle(cx2Data: ParsedCX2): boolean;

  /** Parse entity types from node attributes */
  parseEntityType(node: CX2Node): string;

  /** Extract relationships from edge attributes */
  parseRelationships(edge: CX2Edge): ParsedRelationship[];

  /** Map predicates to ontology terms */
  getOntologyMapping(predicate: string): OntologyMapping;

  /** Get namespace prefixes specific to this dataset */
  getNamespaces(): Record<string, string>;

  /** Get dataset-specific configuration */
  getConfig(): DatasetConfig;
}
```

### 15.3 Current Adapters

#### NCI-PID 2.0 Adapter

**Characteristics**:
- HTML-formatted relationship lists
- INDRA/NCI-PID evidence links
- Protein-only entities (UniProt IDs)
- Post-translational modification relationships

**Implementation**: Described in detail throughout this document (Sections 3-14)

#### Nest Hierarchy Adapter

**Characteristics**: (To be documented based on dataset analysis)
- TBD: Entity types
- TBD: Relationship formats
- TBD: Evidence structures

**Status**: Adapter specification in development

### 15.4 Creating a New Adapter

To add support for a new CX2 dataset:

1. **Analyze Dataset Structure**
   ```typescript
   // Examine sample CX2 files
   // Identify unique characteristics:
   // - Node attribute patterns
   // - Edge attribute formats
   // - Relationship encoding
   // - Evidence metadata
   ```

2. **Create Adapter Class**
   ```typescript
   export class MyDatasetAdapter implements DatasetAdapter {
     readonly datasetId = 'my-dataset';
     readonly datasetName = 'My Biological Dataset';

     canHandle(cx2Data: ParsedCX2): boolean {
       // Detection logic (check for unique attributes, network name patterns, etc.)
       return cx2Data.networkAttributes.some(
         attr => attr.name === 'myDatasetMarker'
       );
     }

     parseEntityType(node: CX2Node): string {
       // Dataset-specific entity type extraction
     }

     parseRelationships(edge: CX2Edge): ParsedRelationship[] {
       // Dataset-specific relationship parsing
     }

     // ... implement other interface methods
   }
   ```

3. **Configure Relationship Mappings (using standard ontologies)**
   ```typescript
   // adapters/my-dataset/relationship-config.ts
   export const RELATIONSHIP_MAPPINGS = {
     'myRelationType': {
       predicate: 'RO:0002XXX',  // Use RO predicate directly
       statementType: 'GO:0000XXX',  // GO type for reified statement (if PTM-like)
       directed: true
     }
   };
   ```

4. **Register Adapter**
   ```typescript
   // core/adapter-registry.ts
   import { MyDatasetAdapter } from '../adapters/my-dataset';

   export const ADAPTERS = [
     new NCIPIDAdapter(),
     new NestHierarchyAdapter(),
     new MyDatasetAdapter()
   ];
   ```

5. **Test Adapter**
   ```typescript
   // tests/adapters/my-dataset.test.ts
   describe('MyDatasetAdapter', () => {
     it('should detect dataset correctly', () => {
       const adapter = new MyDatasetAdapter();
       const cx2Data = loadFixture('my-dataset-example.cx2');
       expect(adapter.canHandle(cx2Data)).toBe(true);
     });

     it('should parse relationships correctly', () => {
       // Test relationship parsing
     });
   });
   ```

### 15.5 Adapter Selection Strategy

The converter automatically selects the appropriate adapter:

```typescript
export class CX2ToRDFConverter {
  private adapters: DatasetAdapter[];

  async convert(cx2Data: CX2Data | string, options?: ConversionOptions) {
    const parsed = this.parseCX2(cx2Data);

    // Auto-detect dataset
    const adapter = this.adapters.find(a => a.canHandle(parsed));

    if (!adapter) {
      throw new Error('No adapter found for this CX2 network');
    }

    // Use adapter for conversion
    return this.convertWithAdapter(parsed, adapter, options);
  }
}
```

Users can also explicitly specify the adapter:

```bash
# CLI: Auto-detect adapter
bio-cx2-to-rdf network.cx2 -o output.ttl

# CLI: Force specific adapter
bio-cx2-to-rdf network.cx2 -o output.ttl --adapter nci-pid

# API: Auto-detect
const result = await converter.convert(cx2Data);

# API: Force specific adapter
const result = await converter.convert(cx2Data, {
  adapter: 'nci-pid'
});
```

### 15.6 Adapter Benefits

**Code Reuse**:
- Core CX2 parsing shared across all adapters
- RDF generation infrastructure reused
- Turtle writing logic unified

**Maintainability**:
- Dataset-specific logic isolated in adapters
- Changes to one dataset don't affect others
- Easy to add new datasets

**Flexibility**:
- Different ontology mappings per dataset
- Custom relationship parsing per dataset
- Dataset-specific validation rules

**Testability**:
- Each adapter can be tested independently
- Shared test utilities for common operations
- Clear boundaries for unit vs integration tests

## 16. Adapting This Design for Other CX2 Networks (Legacy Section)

### 16.1 Overview

**Note**: This section describes the legacy approach for adapting the converter. For new datasets, use the **Adapter Pattern** described in Section 15 instead.

While this converter was initially designed specifically for NCI-PID 2.0 networks, the overall architecture and methodology can be adapted for other types of CX2 biological networks. This section provides guidance on necessary modifications for the legacy approach.

### 16.2 Key Adaptation Areas

#### Entity Type Handling

**NCI-PID 2.0**: All entities are proteins with UniProt identifiers
**Other networks may include**:
- Small molecules/chemicals (ChEBI, PubChem identifiers)
- Gene variants (dbSNP, ClinVar)
- Protein complexes (Complex Portal)
- Biological processes (GO terms)
- Phenotypes (HPO, MONDO)

**Required changes**:
- Update `attributeDeclarations` parsing to handle different type schemas
- Extend namespace configuration for additional identifier systems
- Modify entity type mapping in Section 4.2 for new entity classes
- Update URI builder to handle diverse identifier formats

#### Relationship Format

**NCI-PID 2.0**: HTML-formatted lists with INDRA evidence links
**Other networks may use**:
- Plain text relationship descriptions
- JSON-formatted evidence objects
- Direct predicate-only edges without detailed evidence
- Different evidence source formats

**Required changes**:
- Replace/extend HTML parser (Section 7) with format-specific parsers
- Modify relationship extraction logic for different annotation styles
- Adapt evidence provenance handling for different source databases
- Update predicate mapping configuration for domain-specific relationships

#### Evidence Metadata

**NCI-PID 2.0**: `__edge_source`, `__relationship_score`, evidence counts
**Other networks may have**:
- Different confidence scoring systems
- Alternative evidence attribution models
- Publication-specific metadata (PMIDs, DOIs)
- Experimental evidence codes

**Required changes**:
- Modify edge attribute extraction in Section 3.2
- Update RDF property mappings for different metadata types
- Adapt reified statement structure for alternative provenance models

#### Network Metadata

**NCI-PID 2.0**: Name, description, version, bibliographic reference
**Other networks may include**:
- Organism/species information
- Tissue/cell type context
- Disease associations
- Experimental conditions

**Required changes**:
- Extend network metadata conversion (Section 6.4)
- Add RDF properties for domain-specific metadata
- Update namespace declarations for relevant ontologies

### 16.3 Generalization Strategy

To adapt this converter for a new CX2 network type:

1. **Analyze Network Structure**
   - Examine `attributeDeclarations` to understand attribute schema
   - Identify entity types present in nodes
   - Examine edge attribute structure and relationship formats
   - Document evidence provenance models

2. **Update Configuration**
   - Modify `namespaces.yaml` with new identifier systems
   - Update `predicates.yaml` with domain-specific relationships
   - Create entity type mappings for new types

3. **Adapt Parsers**
   - Modify or replace HTML parser for relationship extraction
   - Update attribute accessor logic for new aliases
   - Handle format-specific edge metadata

4. **Extend RDF Model**
   - Define RDF classes for new entity types
   - Map domain relationships to appropriate predicates
   - Design provenance model for evidence structure

5. **Test and Validate**
   - Convert sample networks from new domain
   - Validate RDF output structure
   - Test SPARQL queries for expected patterns

### 16.4 Core Principles to Preserve

Regardless of CX2 network type, maintain these design principles:

- **Semantic Focus**: Ignore visual aspects, convert only semantic data
- **Evidence Preservation**: Maintain provenance and confidence information
- **Standard Vocabularies**: Use established RDF vocabularies where possible
- **Queryability**: Ensure converted graphs support useful SPARQL queries
- **Modularity**: Keep parsers, processors, and RDF generators separate

### 16.5 Example: Chemical-Protein Interaction Network

A CX2 network containing drug-protein interactions might require:

**Entity types** (using standard ontologies):
- `protein` → `SIO:010043` (protein from SIO)
- `chemical` → `CHEBI:24431` (chemical entity from ChEBI)

**Namespaces**:
```yaml
chebi: "http://purl.obolibrary.org/obo/CHEBI_"
pubchem: "https://pubchem.ncbi.nlm.nih.gov/compound/"
```

**Predicates** (using RO directly):
- "X inhibits Y" → `RO:0002630` (directly negatively regulates)
- "X binds Y" → `RO:0002436` (molecularly interacts with)

**Evidence format**: May use structured JSON instead of HTML

This demonstrates how the core architecture (parser → processor → RDF generator) remains intact while specific mappings and parsers adapt to the network domain.

## 17. Future Enhancements

### 17.1 Potential Improvements

1. **Ontology Alignment**: Map predicates to standard biological ontologies (GO, SO, etc.)
2. **Entity Linking**: Link entities to external databases beyond UniProt
3. **Visualization Export**: Generate visualization metadata in RDF
4. **SPARQL Endpoint**: Provide query interface for converted networks
5. **Incremental Updates**: Support updating existing RDF graphs
6. **Validation**: Add semantic validation against ontologies

### 17.2 Alternative Output Formats

- RDF/XML
- JSON-LD
- N-Triples
- TriG (for named graphs)

## 18. Conclusion

This design provides a comprehensive architecture for the **bio-cx2-to-rdf** converter, a multi-dataset tool for converting biological networks from CX2 format into semantic web-compatible RDF knowledge graphs. The converter uses a **dataset-specific adapter pattern** to support multiple biological network datasets (currently NCI-PID 2.0 and Nest Hierarchy) while maintaining a clean, maintainable codebase.

For **NCI-PID 2.0 networks** specifically, the approach:

- **Focuses on semantic data**: Converts network entities and relationships while ignoring visual presentation aspects
- **Preserves biological information**: Maintains all essential protein entities, relationship types, and interactions
- **Maintains evidence provenance**: Preserves relationship evidence, confidence scores, and source attribution
- **Uses standard vocabularies**: Leverages established RDF vocabularies (Dublin Core, PROV, SKOS) where appropriate
- **Supports SPARQL querying**: Generates RDF structures optimized for semantic queries and knowledge graph integration
- **Handles complexity**: Manages multiple relationship types per edge with proper directionality and symmetry
- **Enables adaptation**: Provides clear guidelines (Section 15) for adapting to other CX2 network types

The modular architecture supports extensibility and maintenance through:
- **Core converter**: Shared CX2 parsing, RDF generation, and Turtle serialization
- **Dataset adapters**: Isolated, testable modules for dataset-specific logic
- **Configuration-driven**: Easy customization of namespaces, predicates, and ontology mappings

The **adapter pattern** (Section 15) provides a clean framework for adding support for new biological network datasets while reusing the core infrastructure and maintaining backward compatibility with existing datasets.

## 19. References

### Specifications and Standards
- CX2 Specification: https://cytoscape.org/cx/cx2/specification/
- RDF 1.1 Turtle: https://www.w3.org/TR/turtle/
- Dublin Core Terms: http://purl.org/dc/terms/
- PROV Ontology: https://www.w3.org/TR/prov-o/
- OWL 2 Web Ontology Language: https://www.w3.org/TR/owl2-overview/

### Biological Ontologies
- Relations Ontology (RO): http://obofoundry.org/ontology/ro.html
- Gene Ontology (GO): http://geneontology.org/
- Molecular Interactions Ontology (MI/PSI-MI): https://www.ebi.ac.uk/ols/ontologies/mi
- Protein Modifications Ontology (PSI-MOD): https://www.ebi.ac.uk/ols/ontologies/mod
- OBO Foundry: http://obofoundry.org/

### Data Sources
- INDRA Database: https://db.indra.bio/
- NCI Pathway Interaction Database (NCI-PID): https://www.ndexbio.org/ (archived pathways)
- NDEx (Network Data Exchange): https://www.ndexbio.org/
- UniProt RDF: http://www.uniprot.org/help/rdf

### Publications
- Pillich RT, Chen J, Churas C, Fong D, Gyori BM, Ideker T, Karis K, Liu SN, Ono K, Pico A, Pratt D. "NDEx IQuery: a multi-method network gene set analysis leveraging the Network Data Exchange". Bioinformatics. 2023 Mar 1;39(3):btad118. https://doi.org/10.1093/bioinformatics/btad118
