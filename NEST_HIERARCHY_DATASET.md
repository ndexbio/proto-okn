# NeST Hierarchy Dataset - Specification Document
## Dataset Adapter for bio-cx2-to-rdf Converter

## Status: 🚧 In Development — RDF mapping TBD; source structure characterized below

This document describes the structure and conversion requirements for the **NeST hierarchy** network in CX2 format. This will guide the implementation of the NeST hierarchy dataset adapter.

> **Scope — this is the hierarchy, a *separate* graph from the interaction network.**
> The IAS interaction network (Data S1, the flat scored protein-pair network the
> hierarchy is *derived from*) is specified and built separately — see
> [IAS_NETWORK_GENERATION.md](IAS_NETWORK_GENERATION.md) and
> [SYMBOL_TO_PROTEIN_MAPPING.md](SYMBOL_TO_PROTEIN_MAPPING.md). The two are linked
> by protein identifiers: system nodes here reference member proteins (via the
> `Genes` attribute) that resolve to the same `uniprot:`/`hgnc:` CURIEs used there.

---

## 1. Dataset Overview

**Name**: NeST 1.0 hierarchical cancer systems map
**Format**: Cytoscape CX2
**Source**: Zheng et al., *Science* 374, eabf3067 (2021), Fig. 4A / Data S3; http://ccmi.org/nest/. Local file: `nest/NeST Map - Main Model.cx2`.
**Description**: A hierarchy of **395 protein systems** ("Nested Systems in Tumors") under mutational selection across 13 cancer types, derived from the IAS network by multiscale community detection (CliXO/HiDeF) and HiSig. Nodes = protein systems (at scales from complexes to broad processes); edges = containment (system-within-system).

### Verified source structure (`nest/NeST Map - Main Model.cx2`)
- **395 nodes** (systems), **466 edges** (containment).
- **Node attributes**: `NEST ID` (e.g. `NEST:60`), `name` (`n`), `Genes` (space-separated HGNC symbols = the system's member proteins), `Size`, `Annotation` (curator-assigned system name, e.g. "Nuclear receptor transcription pathway"), `adjusted p-value` / `-log10 adjusted p-value`, `No. significantly mutated cancer types (aggregate)`, `Significantly mutated cancer types (aggregate)`, and per-cohort `Mutation frequency:<TYPE>` for all 13 tumor types (BLCA, BRCA, COAD, GBM, HNSC, KIRC, LIHC, LUAD, LUSC, OV, SKCM, STAD, UCEC).
- **Edges**: all `interaction = "interacts with"`, split by a `Tree_edge` boolean — **343 `true`** (primary containment; solid arrows in Fig. 4A), **72 `false`** (additional containment = pleiotropy; dashed arrows), **51 unset**. This boolean is the containment semantics and should be preserved (e.g. distinct predicates or a qualifier), not collapsed.
- **Membership**: the `Genes` attribute lists the proteins in each system — the system→protein link. The root node `NEST` lists all ~19,035 genes; individual systems list their members. Some member symbols will be proteins not retained by the interaction-network filter — mint protein IRIs from the union of both sources.

---

## HCX conversion — linking to the IAS interaction network (implemented)

The main model is converted to **HCX** (Hierarchical CX2, spec: https://cytoscape.org/cx/cx2/hcx-specification/) so NDEx/HiView renders it as a browsable hierarchy whose systems link to nodes of the IAS interaction network.

**Script:** [nest/build_hcx_hierarchy.py](nest/build_hcx_hierarchy.py) → [nest/NeST_hierarchy_HCX.cx2](nest/NeST_hierarchy_HCX.cx2).

**The link mechanism:** NDEx preserves CX2 node ids, so IAS node id *N* (name = gene symbol) in [nest/IAS_network.cx2](nest/IAS_network.cx2) is the **same id** in the uploaded NDEx network (verified: id 0→A1BG … id 16839→ZSCAN32, all 16,840 identical). The converter maps each system's `Genes` symbols → those IAS node ids and stores them as `HCX::members`.

**What the converter adds** (all original aspects — nodes, edges, visualProperties, nodeBypasses, etc. — are preserved):

| level | attribute | value |
|---|---|---|
| network | `ndexSchema` | `"hierarchy_v0.1"` (required) |
| network | `HCX::modelFileCount` | `2` (this hierarchy + the interaction network; required) |
| network | `HCX::interactionNetworkUUID` | `e3bb3a6d-878e-11f1-857e-005056ae3c32` (NDEx UUID of the IAS network) |
| node | `HCX::isRoot` (boolean) | `true` on the root, `false` on the other 394 |
| node | `HCX::members` (`list_of_long`) | IAS node ids of the system's genes — **the link** |
| node | `HCX::memberNames` (`list_of_string`) | parallel gene symbols (circle-packing labels) |

- **Root** = the unique node never a containment *target* (edges run parent `s` → child `t`); resolves to `NEST` (id 41341). One `isRoot=true`, 394 `false`.
- **Coverage:** 55,572 / 57,771 gene slots (96.2%) map to an IAS node; **2,195 distinct symbols don't** — the root's full-genome padding plus IL36G/SPAAR (no IAS edge above the 0.18 floor, so no node to link). These stay in the untouched `Genes` attribute but are absent from `HCX::members` (`members ⊆ Genes`). Root: 16,840 of its 19,035 genes become members.
- **Validated:** all 55,572 `HCX::members` ids resolve to the correct IAS node (0 missing, 0 id→name mismatches); members are integers (`long`).

**To publish:** upload `NeST_hierarchy_HCX.cx2` to NDEx; HiView resolves `HCX::interactionNetworkUUID` to render systems over the IAS network. (Upload is a manual step — not done by the script.)

---

## 2. Dataset Characteristics

### 2.1 Network Structure

**To be documented:**
- Number of sample networks available
- Typical network size (nodes/edges)
- Network domain (e.g., gene regulation, protein interactions, pathways)

### 2.2 Entity Types

**Node Types** (TBD):
```
Examples to document:
- What types of biological entities are represented?
- Are they proteins, genes, complexes, processes?
- How are entity types indicated in node attributes?
```

### 2.3 Relationship Types

**Edge Types** (TBD):
```
Examples to document:
- What types of relationships exist between entities?
- Regulatory relationships? Physical interactions?
- How are relationships encoded in edge attributes?
```

### 2.4 Evidence and Metadata

**Evidence Structure** (TBD):
```
Questions to answer:
- How is evidence for relationships stored?
- Is there HTML formatting like NCI-PID 2.0?
- Are there confidence scores?
- What are the evidence sources?
```

---

## 3. Sample CX2 Structure

**Please provide a sample CX2 network file for analysis.**

### 3.1 Sample Network Attributes

```json
{
  "networkAttributes": [
    // TBD: Paste example network attributes
  ]
}
```

### 3.2 Sample Nodes

```json
{
  "nodes": [
    {
      "id": 1,
      "v": {
        // TBD: Paste example node attributes
      }
    }
  ]
}
```

### 3.3 Sample Edges

```json
{
  "edges": [
    {
      "id": 1,
      "s": 1,
      "t": 2,
      "v": {
        // TBD: Paste example edge attributes
      }
    }
  ]
}
```

### 3.4 Attribute Declarations

```json
{
  "attributeDeclarations": [
    // TBD: Paste example attribute declarations
  ]
}
```

---

## 4. RDF Mapping Requirements

### 4.1 Entity Type Mapping

**Node types → RDF classes** (TBD):

| CX2 Node Type | RDF Class | Notes |
|---------------|-----------|-------|
| TBD | `oknr:TBD` | TBD |

### 4.2 Relationship Mapping

**Edge types → RDF predicates** (TBD):

| Relationship Text | RDF Predicate | Ontology Mapping | Notes |
|-------------------|---------------|------------------|-------|
| TBD | `oknr:TBD` | TBD | TBD |

### 4.3 Ontology Alignment

**Which ontologies should Nest Hierarchy relationships map to?**

Options to consider:
- **Relations Ontology (RO)**: For standard biological relations
- **Gene Ontology (GO)**: For biological processes, molecular functions
- **Sequence Ontology (SO)**: For sequence features
- **Systems Biology Ontology (SBO)**: For systems biology concepts
- **Custom ontologies**: Dataset-specific vocabularies

**TBD**: Specify which ontologies are most appropriate for Nest Hierarchy relationships.

---

## 5. Adapter Implementation Plan

### 5.1 Adapter Interface Implementation

```typescript
export class NestHierarchyAdapter implements DatasetAdapter {
  readonly datasetId = 'nest-hierarchy';
  readonly datasetName = 'Nest Hierarchy';

  canHandle(cx2Data: ParsedCX2): boolean {
    // TBD: How to detect if a CX2 network is from Nest Hierarchy?
    // Options:
    // - Check for specific network attribute names
    // - Pattern matching on network name
    // - Presence of unique node/edge attributes
    return false; // To be implemented
  }

  parseEntityType(node: CX2Node): string {
    // TBD: How to extract entity type from node attributes?
    return 'unknown';
  }

  parseRelationships(edge: CX2Edge): ParsedRelationship[] {
    // TBD: How to extract relationships from edge attributes?
    return [];
  }

  getOntologyMapping(predicate: string): OntologyMapping {
    // TBD: Map predicates to ontology terms
    return {};
  }

  getNamespaces(): Record<string, string> {
    // TBD: What namespace prefixes are needed?
    return {};
  }

  getConfig(): DatasetConfig {
    // TBD: Dataset-specific configuration
    return {};
  }
}
```

### 5.2 Relationship Parser

**What format are relationships stored in?**

- [ ] HTML formatted (like NCI-PID 2.0)
- [ ] Plain text
- [ ] JSON object
- [ ] Other: [describe]

**Implementation Strategy** (TBD):
```typescript
// Example if HTML formatted:
class NestHierarchyHTMLParser {
  parse(html: string): ParsedRelationship[] {
    // TBD
  }
}

// Example if JSON formatted:
class NestHierarchyJSONParser {
  parse(json: any): ParsedRelationship[] {
    // TBD
  }
}
```

### 5.3 URI Construction

**How should entities be identified in RDF?**

Options:
- Use existing identifiers (UniProt, HGNC, etc.)
- Generate custom URIs based on node IDs
- Use a combination of both

**TBD**: Specify URI construction strategy.

---

## 6. Questions to Answer

Please provide information for the following:

### 6.1 Dataset Detection
- [ ] What unique attributes or patterns can identify a Nest Hierarchy network?
- [ ] Are there specific network attribute names or values?
- [ ] Is there a standard naming convention for these networks?

### 6.2 Entity Information
- [ ] What types of biological entities are in Nest Hierarchy networks?
- [ ] How are entity types indicated?
- [ ] What identifiers are used (UniProt, HGNC, GO, custom)?
- [ ] Are there entity hierarchies or classifications?

### 6.3 Relationship Information
- [ ] What types of relationships exist between entities?
- [ ] How are relationships encoded in CX2 edges?
- [ ] Is there a controlled vocabulary for relationship types?
- [ ] How is directionality handled?

### 6.4 Evidence and Provenance
- [ ] How is evidence for relationships represented?
- [ ] What are the evidence sources?
- [ ] Are there confidence scores or quality metrics?
- [ ] How should provenance be tracked in RDF?

### 6.5 Ontology Preferences
- [ ] Which biological ontologies are most relevant?
- [ ] Are there existing ontology mappings to follow?
- [ ] Should we create new ontology terms?

---

## 7. Sample Networks Needed

To implement the Nest Hierarchy adapter, please provide:

1. **Small example network** (10-50 nodes) for initial testing
2. **Medium example network** (100-500 nodes) for integration testing
3. **Large example network** (1000+ nodes) for performance testing
4. **Documentation** of the dataset structure, if available

**Where to find sample networks:**
- [ ] Public repository URL: [TBD]
- [ ] NDEx collection: [TBD]
- [ ] Other source: [TBD]

---

## 8. Implementation Checklist

Once the above information is provided, the adapter implementation will proceed through these steps:

- [ ] Analyze sample CX2 files
- [ ] Document attribute structure
- [ ] Design RDF mapping strategy
- [ ] Select appropriate ontologies
- [ ] Implement `NestHierarchyAdapter` class
- [ ] Implement relationship parser
- [ ] Configure ontology mappings
- [ ] Write unit tests
- [ ] Write integration tests
- [ ] Document adapter usage
- [ ] Register adapter in `AdapterRegistry`

---

## 9. Contact and Collaboration

**Primary Contact:** [Your name/email]
**Dataset Owner:** [TBD]
**Documentation:** [TBD]

**Questions or Feedback:**
Please open an issue in the bio-cx2-to-rdf repository or contact the team directly.

---

## Next Steps

1. **Provide sample CX2 files** from Nest Hierarchy dataset
2. **Fill in TBD sections** with dataset-specific information
3. **Review and approve** the RDF mapping strategy
4. **Begin adapter implementation** following the plan above

---

**Last Updated:** [Date]
**Status:** Awaiting dataset information
