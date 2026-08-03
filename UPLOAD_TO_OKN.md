# Uploading Graphs to Proto-OKN

This document describes how to upload a knowledge graph (e.g. an RDF/Turtle
conversion of an NDEx network) to the Proto-OKN repository hosted on the FRINK
lakeFS instance.

The repository uses a Git-like branching model: you stage and commit changes on
a working branch (`develop`), open a pull request into `main`, review it, and
then merge. Merging into `main` triggers a conversion pipeline that serves the
graph; once conversion finishes you receive an email and tag the resulting
stable branch. Nothing lands in `main` until the pull request is merged, and the
graph is not fully published until it has been tagged.

## Prerequisites

- A FRINK lakeFS **access key ID** and **secret access key**.
- The files you intend to upload (e.g. the merged `.ttl` Turtle file and any
  registry metadata such as `ncipidkg.md`).

> **Handle credentials as secrets.** Do not commit the access key ID or secret
> key to any repository, paste them into shared documents, or check them into
> the graph files themselves. Store them in a password manager or a local,
> untracked credentials file.

## Steps

### 1. Log in

Go to <https://repository.okn.us/> and log in with your access key ID and
secret access key.

### 2. Select the repository

From the repository list, choose the one you want to work in. For the NCI-PID
knowledge graph, select
[**ncipidkg**](https://repository.okn.us/repositories/ncipidkg/objects).
Substitute the appropriate repository if you are working on a different graph.

### 3. Switch to the `develop` branch

Make sure you are on the **`develop`** branch before uploading — this is the
working branch. Do **not** upload directly to `main`.

### 4. Upload files and make changes

Upload your files and make any additions or modifications as needed on the
`develop` branch. This can include:

- The graph data itself (e.g. the RDF/Turtle file).
- Registry or metadata files (e.g. `ncipidkg.md`).

Commit your changes to `develop` once the uploads look correct.

### 5. Open a pull request into `main`

Create a pull request from `develop` into `main`. Give it a clear title and
description summarizing what changed (which graph, what was added or updated,
and any notable details such as size or record counts).

### 6. Review

Review the pull request — the diff of objects being added or changed — as
needed. If you are collaborating with someone, have them review it too before
merging. This is the checkpoint for catching mistakes before anything reaches
`main`.

### 7. Merge into `main`

Once the review is complete, use the repository interface to merge the pull
request into `main`. Merging into `main` triggers the conversion pipeline (see
next step) — it is not just a code merge, so only merge when the data is ready
to be published.

### 8. Wait for conversion and the notification email

Merging into `main` automatically kicks off the first conversion steps, which
convert your data into the **qlever** and **hdt** formats used to serve the
graph. When conversion finishes, the pipeline creates a new stable branch named
like **`stable_v0_0_2`**, and an email is sent to you with instructions,
pointing to that new branch and telling you what to tag it as.

> **If you do not receive an email**, do not assume the upload failed silently —
> the conversion may have errored or the notification may not have gone out.
> Ping the OKN team (e.g. in the OKN Slack) to check on the status of the
> conversion before proceeding.

### 9. Tag the stable branch

The final action is tagging the new stable branch. Following the email's
instructions, add a **lakeFS tag** (similar to a GitHub tag) to the stable
branch. Tags can be viewed and added at
<https://repository.okn.us/repositories/ncipidkg/tags> (substitute your
repository).

Use the conventional naming pattern: a branch named `stable_v0_0_2` is tagged as
**`v0.0.2`**. Following this convention is recommended — it is how OKN tracks
versions consistently across the several knowledge graphs they host. The graph
is not considered fully published until this tag has been added.

## Summary

| Step | Branch / Action |
|---|---|
| Log in | <https://repository.okn.us/> |
| Select repository | e.g. `ncipidkg` |
| Upload & commit | `develop` |
| Open pull request | `develop` → `main` |
| Review | pull request diff |
| Merge | into `main` via the interface (triggers conversion) |
| Wait for conversion | qlever / hdt build; new `stable_v0_0_X` branch + email |
| Tag | tag `stable_v0_0_X` as `v0.0.X` |

## Notes

- Always work on `develop` first; `main` should only ever receive changes
  through a reviewed, merged pull request.
- Keep commit messages and pull request descriptions specific enough that a
  collaborator can tell what graph changed and why without opening every file.
- Merging into `main` is what triggers the conversion pipeline — treat the merge
  as "publish," not just "save."
- Expect an email once conversion completes. **If no email arrives, ping the OKN
  team to check the conversion status** rather than waiting indefinitely.
- The final step is always tagging the new `stable_v0_0_X` branch as `v0.0.X`.
  The graph is not fully published until it is tagged.