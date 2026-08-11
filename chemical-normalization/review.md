# Small-molecule identifier normalization — review

Generated: 2026-08-11
Source: 217 CX2 file(s), node types `smallmolecule`
Distinct identifiers: 44 (155 node instances)
Normalizer: https://nodenormalization-sri.renci.org/get_normalized_nodes (conflate + drug_chemical_conflate)

Policy: PubChem CID when available, else ChEBI, else the source identifier
is kept. The full clique is recorded in `snapshot.json` for `skos:exactMatch`.

## Summary

| Flag | Count | Meaning |
|---|---:|---|
| `CHEBI-DRIFT` | 2 | Normalizer returned a different ChEBI than the source — a stereoisomer/salt/class merge. Review before accepting. |
| `OVERRIDE` | 3 | A curated decision overrides the normalizer here; see `override_reason`. |
| `NO-CID` | 7 | No PubChem CID in the clique; using ChEBI. |
| `OK` | 27 | Resolved to a PubChem CID (OKN-preferred). |
| `UNRESOLVED` | 3 | Normalizer does not recognize this identifier; source kept unchanged. |
| `NO-ID` | 2 | Node has no CURIE identifier (bare name); not normalizable. |

## Rows

| Source | Name | Flag | Chosen | PubChem | ChEBI | Normalizer label | Collides with | Nodes |
|---|---|---|---|---|---|---|---|---:|
| `CHEBI:17336` | all-trans-retinol | `CHEBI-DRIFT` | `PUBCHEM.COMPOUND:445354` | 445354 | CHEBI:12777 | Vitamin A | — | 2 |
| `CHEBI:31690` | imatinib methanesulfonate | `CHEBI-DRIFT` | `PUBCHEM.COMPOUND:5291` | 5291 | CHEBI:45783 | Imatinib | — | 1 |
| `CHEBI:16066` | 11-cis-retinal | `OVERRIDE` | `CHEBI:16066` | 638015 | CHEBI:17898 | RETINAL | — | 2 |
| `CHEBI:17898` | all-trans-retinal | `OVERRIDE` | `CHEBI:17898` | 638015 | CHEBI:17898 | RETINAL | — | 2 |
| `CHEBI:28940` | calciol | `OVERRIDE` | `CHEBI:28940` | 5280793 | CHEBI:27300 | Ergocalciferol | — | 1 |
| `CHEBI:16618` | 1-phosphatidyl-1D-myo-inositol 3,4,5-trisphosphate | `NO-CID` | `CHEBI:16618` | — | CHEBI:16618 | 1-phosphatidyl-1D-myo-inositol 3,4,5-trisphosphate | — | 5 |
| `CHEBI:3098` | bile acid | `NO-CID` | `CHEBI:3098` | — | CHEBI:3098 | bile acid | — | 1 |
| `CHEBI:50114` | estrogen | `NO-CID` | `CHEBI:50114` | — | CHEBI:50114 | estrogen | — | 1 |
| `CHEBI:24547` | hexadecenal | `NO-CID` | `CHEBI:24547` | — | CHEBI:24547 | hexadecenal | — | 1 |
| `CHEBI:39026` | low-density lipoprotein | `NO-CID` | `CHEBI:39026` | — | CHEBI:39026 | low-density lipoprotein | — | 1 |
| `CHEBI:16337` | phosphatidic acid | `NO-CID` | `CHEBI:16337` | — | CHEBI:16337 | Phosphatidate | — | 10 |
| `CHEBI:26523` | reactive oxygen species | `NO-CID` | `CHEBI:26523` | — | CHEBI:26523 | reactive oxygen species | — | 1 |
| `CHEBI:16302` | 11-cis-retinol | `OK` | `PUBCHEM.COMPOUND:5280382` | 5280382 | CHEBI:16302 | 11-cis-retinol | — | 2 |
| `CHEBI:16330` | 17beta-hydroxy-5alpha-androstan-3-one | `OK` | `PUBCHEM.COMPOUND:10635` | 10635 | CHEBI:16330 | Stanolone | — | 6 |
| `CHEBI:16595` | 1D-myo-inositol 1,4,5-trisphosphate | `OK` | `PUBCHEM.COMPOUND:439456` | 439456 | CHEBI:16595 | INS(1,4,5)P3 | — | 27 |
| `CHEBI:52392` | 2-arachidonoylglycerol | `OK` | `PUBCHEM.COMPOUND:5282280` | 5282280 | CHEBI:52392 | 2-arachidonoylglycerol | — | 1 |
| `CHEBI:17489` | 3',5'-cyclic AMP | `OK` | `PUBCHEM.COMPOUND:6076` | 6076 | CHEBI:17489 | Cyclic AMP | — | 6 |
| `CHEBI:16356` | 3',5'-cyclic GMP | `OK` | `PUBCHEM.COMPOUND:135398570` | 135398570 | CHEBI:16356 | Cyclic GMP | — | 4 |
| `cas:11128-99-7` | Angiotensin II | `OK` | `PUBCHEM.COMPOUND:25476` | 25476 | — | Angiotensina II | — | 1 |
| `CHEBI:48080` | brefeldin A | `OK` | `PUBCHEM.COMPOUND:5287620` | 5287620 | CHEBI:48080 | Brefeldin A | — | 1 |
| `CHEBI:16113` | cholesterol | `OK` | `PUBCHEM.COMPOUND:5997` | 5997 | CHEBI:16113 | Cholesterol | — | 3 |
| `CHEBI:15354` | choline | `OK` | `PUBCHEM.COMPOUND:305` | 305 | CHEBI:15354 | Choline | — | 9 |
| `CHEBI:17650` | cortisol | `OK` | `PUBCHEM.COMPOUND:5754` | 5754 | CHEBI:17650 | Hydrocortisone | — | 3 |
| `CHEBI:4031` | cyclosporin A | `OK` | `PUBCHEM.COMPOUND:5284373` | 5284373 | CHEBI:4031 | Cyclosporine | — | 1 |
| `cas:51-61-6` | Dopamine | `OK` | `PUBCHEM.COMPOUND:681` | 681 | CHEBI:18243 | Dopamine | — | 1 |
| `cas:50-28-2` | E2 | `OK` | `PUBCHEM.COMPOUND:5757` | 5757 | CHEBI:16469 | Estradiol | — | 6 |
| `cas:85305-87-9` | glucosylceramide | `OK` | `PUBCHEM.COMPOUND:6475228` | 6475228 | CHEBI:84744 | beta-D-glucosyl-N-(tetracosanoyl)sphingosine | — | 1 |
| `cas:17-18-8` | glutathione | `OK` | `PUBCHEM.COMPOUND:124886` | 124886 | CHEBI:16856 | Glutathione | — | 1 |
| `CHEBI:28087` | glycogen | `OK` | `PUBCHEM.COMPOUND:439177` | 439177 | CHEBI:28087 | glycogen | — | 1 |
| `cas:9005-49-6` | heparin | `OK` | `PUBCHEM.COMPOUND:22833565` | 22833565 | CHEBI:28304 | Heparin | — | 1 |
| `cas:74-79-3` | L-arginine | `OK` | `PUBCHEM.COMPOUND:6322` | 6322 | CHEBI:16467 | Arginine | — | 7 |
| `cas:372-75-8` | L-citrulline | `OK` | `PUBCHEM.COMPOUND:9750` | 9750 | CHEBI:16349 | Citrulline | — | 7 |
| `CHEBI:78331` | PP2 | `OK` | `PUBCHEM.COMPOUND:4878` | 4878 | CHEBI:78331 | PP2 | — | 1 |
| `CHEBI:15552` | prostaglandin I2 | `OK` | `PUBCHEM.COMPOUND:5282411` | 5282411 | CHEBI:15552 | Epoprostenol | — | 1 |
| `CHEBI:37550` | sphingosine 1-phosphate | `OK` | `PUBCHEM.COMPOUND:5283560` | 5283560 | CHEBI:37550 | sphingosine 1-phosphate | — | 10 |
| `CHEBI:61049` | tacrolimus (anhydrous) | `OK` | `PUBCHEM.COMPOUND:445643` | 445643 | CHEBI:61049 | Tacrolimus | — | 3 |
| `CHEBI:17347` | testosterone | `OK` | `PUBCHEM.COMPOUND:6013` | 6013 | CHEBI:17347 | Testosterone | — | 5 |
| `CHEBI:15627` | thromboxane A2 | `OK` | `PUBCHEM.COMPOUND:5280497` | 5280497 | CHEBI:15627 | thromboxane A2 | — | 1 |
| `cas:133-89-1` | UDP-D-glucose | `OK` | `PUBCHEM.COMPOUND:8629` | 8629 | CHEBI:46229 | UDP-glucose | — | 1 |
| `cas:24696-26-2` | ceramide | `UNRESOLVED` | `CAS:24696-26-2` | — | — | — | — | 6 |
| `cas:22556-62-3` | LPA | `UNRESOLVED` | `CAS:22556-62-3` | — | — | — | — | 2 |
| `cas:9031-54-3` | sphingomyelin | `UNRESOLVED` | `CAS:9031-54-3` | — | — | — | — | 6 |
| `LPS` | LPS | `NO-ID` | `LPS` | — | — | — | — | 1 |
| `TH` | TH | `NO-ID` | `TH` | — | — | — | — | 1 |

## Curated overrides

Decisions applied on top of the normalizer, with their evidence.

- **11-cis-retinal** — `CHEBI:16066` → kept as `CHEBI:16066`
  COLLISION: normalizes to PUBCHEM.COMPOUND:638015 ("Retinal"), the same CID as CHEBI:17898 (all-trans-retinal). 11-cis -> all-trans isomerization is the photon-detection step of visual signal transduction; merging the two would reduce the pathway's central reaction to a self-loop.
- **all-trans-retinal** — `CHEBI:17898` → kept as `CHEBI:17898`
  COLLISION: shares PUBCHEM.COMPOUND:638015 with CHEBI:16066 (11-cis-retinal). See that entry.
- **calciol** — `CHEBI:28940` → kept as `CHEBI:28940`
  WRONG COMPOUND: calciol is vitamin D3 (cholecalciferol), but the clique resolves to CHEBI:27300 / PUBCHEM.COMPOUND:5280793, both verified as ergocalciferol (vitamin D2). D2 is not D3.
- **glutathione** — `cas:17-18-8` → queried as `CAS:70-18-8`
  SOURCE DATA ERROR: the CX2 records glutathione as CAS 17-18-8, which is not a valid registry number. Glutathione is CAS 70-18-8 (CHEBI:16856).
