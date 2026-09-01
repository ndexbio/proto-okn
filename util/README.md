# util

Utility scripts for the NCI-PID 2.0 KG pipeline.

| Script | Language | Role |
|--------|----------|------|
| [`download-networks.mjs`](download-networks.mjs) | Node.js | Download source pathway networks from NDEx as `.cx2` files. |
| [`merge_cx2.py`](merge_cx2.py) | Python | Merge the downloaded `.cx2` files into one deduplicated, NDEx-loadable network. |

## `download-networks.mjs`

Downloads a set of NDEx networks (by UUID) in native **CX2** format and stores
them as `.cx2` files in the output directory. This is the first step of the
pipeline: it fetches the source pathway networks that `merge_cx2.py` merges and
`bio-cx2-to-rdf` converts to RDF.

The UUIDs are read from a CSV with a single `network_id` column. The NCI-PID 2.0
pathway set lives in [`../data_files/network_list.csv`](../data_files/network_list.csv).

Networks are fetched with
[`@js4cytoscape/ndex-client`](https://www.npmjs.com/package/@js4cytoscape/ndex-client)
via `client.networks.getRawCX2Network(uuid)`, which performs
`GET /v3/networks/{uuid}` and returns the native CX2 aspect array — exactly the
on-disk format the downstream tools consume.

### Prerequisites

- Node.js 20.17+ or 22.9+ (developed against Node 25)
- `npm install` in this directory

```bash
cd util
npm install
```

### Usage

```bash
# Download every network in data_files/network_list.csv into data_files/
npm run download

# Equivalent direct invocation, with options
node download-networks.mjs [options]
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `--list <path>` | `../data_files/network_list.csv` | CSV with a single `network_id` column of UUIDs. |
| `--out <dir>` | `../data_files` | Output directory for the `.cx2` files. |
| `--concurrency <n>` | `4` | Number of parallel downloads. |
| `--server <url>` | `https://www.ndexbio.org` | NDEx server base URL. |
| `--by-uuid` | off | Name files `<uuid>.cx2` instead of by network name. |
| `--force` | off | Re-download networks already recorded in the manifest. |
| `-h`, `--help` | — | Show help. |

### Output

- **`<network name>.cx2`** — one file per network, named after the network's own
  name (sanitized for the filesystem) so `merge_cx2.py` can derive pathway names
  from filenames. Networks without a name (or runs with `--by-uuid`) are named
  `<uuid>.cx2`. Name collisions across different UUIDs are disambiguated by
  appending a short UUID prefix.
- **`download-manifest.json`** — a `uuid -> { file, name }` map written to the
  output directory. It preserves the UUID provenance that filenames lose, and it
  drives **resumable re-runs**: a UUID already in the manifest whose file still
  exists is skipped unless `--force` is given.

The script prints per-network progress to stderr and exits non-zero if any
download failed, listing the failures at the end. Re-running picks up only the
missing/failed networks.

### Examples

```bash
# Full set, 8 parallel downloads
node download-networks.mjs --concurrency 8

# A custom list into a scratch directory, named by UUID
node download-networks.mjs --list my_uuids.csv --out /tmp/nets --by-uuid

# Force a fresh re-download of everything
node download-networks.mjs --force
```

## `merge_cx2.py`

Merges multiple NCI-PID CX2 network files into a single, deduplicated,
NDEx-loadable CX2 network, preserving INDRA relationship evidence. This is the
second step of the pipeline: it consumes the `.cx2` files produced by
`download-networks.mjs` and produces one merged network that `bio-cx2-to-rdf`
converts to RDF.

See [`merge_cx2.md`](merge_cx2.md) for the full design — the pass-by-pass
algorithm, dedup/collapse semantics, and ordering rationale. In brief, it:

- **deduplicates nodes** across files by their namespaced `represents` identifier
  (e.g. `uniprot:O14636`), so a gene in many pathways becomes one node;
- **deduplicates and collapses edges** so a node pair has at most two edges (one
  per direction), unioning INDRA evidence rather than dropping it;
- **slims the `Relationships` HTML** to exactly the items the `bio-cx2-to-rdf`
  converter reads (lossless for RDF, smaller file);
- optionally adds **pathway-provenance nodes** (`--pathway-nodes`) recording which
  source file each node came from.

### Merged network attributes

The merged network's `networkAttributes` are set as follows:

- **`name`** = `"merged nci-pid 2.0 network"`.
- **`description`** and **`reference`** = copied from the **first** source network
  (sorted filename order).
- **`@context`** = the union of every source network's `@context`, plus an
  `ndex` prefix → `https://www.ndexbio.org/v3/networks/`. If two networks map the
  **same prefix to different URIs**, the first wins and the conflict is reported
  on stderr naming both URIs and both source files.

With `--pathway-nodes`, each pathway node's `represents` is **`ndex:<uuid>`**
(resolving via the `@context` to the source network's NDEx URL) when the UUID is
known — supply it with `--uuid-map` (see below); otherwise it falls back to a
non-resolvable `pathway:<name>`.

### Prerequisites

- Python 3 (standard library only — no third-party packages required)

### Usage

```bash
# From this directory: merge every .cx2 in ../data_files into merged_ncipid.cx2
python merge_cx2.py ../data_files merged_ncipid.cx2

# Add pathway-membership provenance nodes, with NDEx UUIDs from the download
# manifest so pathway nodes get ndex:<uuid> represents IRIs
python merge_cx2.py ../data_files merged_ncipid.cx2 \
    --pathway-nodes --uuid-map ../data_files/download-manifest.json
```

> **Note:** the input directory is scanned for `*.cx2` files, so point it at a
> directory containing only the pathway networks. `../data_files` also holds
> `download-manifest.json` (ignored, not a `.cx2`) and any merged output you write
> there — keep merged output out of the input directory, or it will be re-ingested
> on the next run.

### Arguments and flags

| Argument / Flag | Default | Description |
|---|---|---|
| `input_dir` | `cx2_networks` | Directory scanned for `*.cx2` files (sorted filename order; first file wins for shared attributes/coordinates/styling). |
| `output_file` | `merged_ncipid.cx2` | Path for the merged CX2 output. |
| `--no-slim` | slimming on | Keep the full original `Relationships` HTML instead of reducing it to converter-relevant items. |
| `--no-collapse` | collapse on | Skip the direction-aware edge collapse (edges are still deduplicated by full content). |
| `--pathway-nodes` | off | Add one `type: "pathway"` node per source file plus `participates in` edges to its members. |
| `--uuid-map <path>` | none | JSON mapping used to give pathway nodes `ndex:<uuid>` represents IRIs. Accepts either a `{filename: uuid}` map or the `download-manifest.json` produced by `download-networks.mjs` (`{uuid: {file, name}}`), which it inverts automatically. Only used with `--pathway-nodes`. |

## Pipeline context

```
util/download-networks.mjs   →  data_files/*.cx2   (download from NDEx)
util/merge_cx2.py            →  merged_ncipid.cx2  (dedup + collapse)
bio-cx2-to-rdf               →  *.ttl              (RDF Turtle)
```

## `ncipid_pathway_to_identifiers_mapping_file.py`

Builds a pathway redirect CSV by matching pathway labels in a merged RDF Turtle
file to NDEx network names from a UUID list. For each match, it writes the
pathway identifier and the corresponding NDEx network URL.

### Prerequisites

- Python 3
- `pandas`
- `ndex2`
- Network access to NDEx

### Usage

```bash
python ncipid_pathway_to_identifiers_mapping_file.py \
    ../data_files/network_list.csv \
    ../path/to/merged.ttl \
    --output_file pathway_redirects.csv
```

### Arguments and flags

| Argument / Flag | Default | Description |
|---|---|---|
| `network_list_file` | required | CSV containing a `network_id` column of NDEx UUIDs. |
| `merged_ttl_file` | required | Merged Turtle file containing `pathway:` subjects and `rdfs:label` pathway names. |
| `--output_file <path>` | `pathway_redirects.csv` | Output CSV path. |

The generated CSV has two columns:

```csv
ID,URL
pathway_identifier,https://www.ndexbio.org/#/network/<uuid>
```
