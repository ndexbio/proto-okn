#!/usr/bin/env python3
"""
Filter the raw IAS edge list (Data S1) into the network to be converted.

Rule (see IAS_NETWORK_GENERATION.md §3):
  Keep the UNION of
    (a) every edge with Integrated score >= --ias-floor      -> edge_role = core
    (b) each protein's single strongest (highest-IAS) edge    -> edge_role = backbone
  (b) is a no-op for proteins already covered by (a); it only rescues proteins the
  floor would strand, so the result has NO orphan nodes. Disconnected islands are
  allowed (no cross-component bridging).

Output = input columns + an appended `edge_role` column (core | backbone).

Input : abf3067_Data_S1.tsv  (Protein 1, Protein 2, Integrated score, 5x evidence)
Output: ias_network_no_orphans.tsv
"""
import argparse, csv


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--network", default="science.abf3067_data_s1_to_s3/abf3067_Data_S1.tsv",
                    help="raw Data S1 edge list")
    ap.add_argument("--ias-floor", type=float, default=0.30, help="core IAS threshold (default 0.30)")
    ap.add_argument("--score-col", default="Integrated score")
    ap.add_argument("--p1-col", default="Protein 1")
    ap.add_argument("--p2-col", default="Protein 2")
    ap.add_argument("--out", default="ias_network_no_orphans.tsv")
    args = ap.parse_args()

    with open(args.network, newline='') as f:
        r = csv.reader(f, delimiter='\t')
        header = next(r)
        rows = list(r)
    si = header.index(args.score_col)
    ai = header.index(args.p1_col)
    bi = header.index(args.p2_col)

    # (b) each protein's single strongest edge (index into rows)
    best = {}
    for idx, row in enumerate(rows):
        s = float(row[si])
        for x in (row[ai], row[bi]):
            if x not in best or s > best[x][0]:
                best[x] = (s, idx)

    # (a) core edges by threshold, then (b) backbone rescues
    role = {}
    for idx, row in enumerate(rows):
        if float(row[si]) >= args.ias_floor:
            role[idx] = "core"
    for x, (s, idx) in best.items():
        if idx not in role:
            role[idx] = "backbone"

    kept = [rows[idx] + [role[idx]] for idx in sorted(role)]

    with open(args.out, 'w', newline='') as g:
        w = csv.writer(g, delimiter='\t', lineterminator='\n')
        w.writerow(header + ["edge_role"])
        w.writerows(kept)

    n_core = sum(1 for k in kept if k[-1] == "core")
    n_back = len(kept) - n_core
    prots = {row[ai] for row in kept} | {row[bi] for row in kept}
    all_prots = {row[ai] for row in rows} | {row[bi] for row in rows}
    print(f"wrote {args.out}")
    print(f"  input edges ...... {len(rows):,}")
    print(f"  kept edges ....... {len(kept):,}  (core {n_core:,} + backbone {n_back:,})")
    print(f"  proteins ......... {len(prots):,}  (orphans: {len(all_prots) - len(prots)})")


if __name__ == "__main__":
    main()
