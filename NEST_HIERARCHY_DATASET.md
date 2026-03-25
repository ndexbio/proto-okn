# Nest Hierarchy Dataset - Specification Document
## Dataset Adapter for bio-cx2-to-rdf Converter

## Status: 🚧 In Development

This document describes the structure and conversion requirements for **Nest Hierarchy** networks in CX2 format. This will guide the implementation of the Nest Hierarchy dataset adapter.

---

## 1. Dataset Overview

**Name**: Nest Hierarchy
**Format**: Cytoscape CX2
**Source**: [TBD - Please provide source/repository]
**Description**: [TBD - Please describe what Nest Hierarchy networks represent]

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
