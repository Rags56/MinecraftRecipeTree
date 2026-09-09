# Core dataset R2 publication

Complete packed exports are published as immutable R2 object sets. This removes large item and
block render packs from the Sites deployment artifact, so adding a modpack does not require a
new application deployment or clone hundreds of megabytes of already-compressed WebP data.

The tradeoff is operational rather than visual: R2 reads are metered, while Cloudflare static
asset reads are generally cheaper. The Worker therefore serves publication-addressed objects
with immutable edge caching. Keeping packs inside the Sites artifact avoids R2 operations but
scales deployment size linearly with every modpack. For a multi-user exporter, the R2 model is
the bounded, horizontally scalable option.

## Build the local control bundle

The input must already be a complete coordinate-packed export with a verified
`manifest.publicationId`. The builder never rewrites or copies that export. It writes only the
small deterministic control bundle: `publication.json` and one MRPI authorization index per
packed-image blob.

```bash
npm run build:core-publication -- \
  --root /path/to/packed/exports \
  --output /new/path/core-publication-bundle \
  --concurrency 8
```

The output must be outside the source export. A matching existing output is revalidated and
reused; a conflicting output is rejected. A new output is assembled in a sibling staging
directory and becomes visible by one atomic rename only after the source publication hash,
every object digest, and every generated index have been rechecked.

The builder fails closed when it finds any of the following:

- an unsupported, special, or symlinked source entry;
- invalid JSON, a false publication ID, or a document larger than 8 MiB;
- nonconsecutive or oversized 1 MiB packs;
- a malformed, overlapping, missing, or out-of-pack image coordinate;
- bytes in a pack that are not covered by an exact document-referenced WebP boundary; or
- a source mutation between analysis and the atomic bundle commit.

There is no broad byte-range fallback. If exact authorization cannot be proven, no publication
bundle is produced.

## Control manifest contract

`publication.json` uses canonical compact JSON with recursively sorted object keys and exactly
one final newline. The v1 shape is:

```json
{
  "format": "mrt-core-dataset-publication-v1",
  "publicationId": "<lowercase SHA-256>",
  "maxDocumentBytes": 8388608,
  "maxPackBytes": 1048576,
  "packIndexFormat": "mrt-packed-image-authorization-index-v1",
  "maxPackIndexBytes": 524288,
  "counts": {
    "documents": 1,
    "packs": 1,
    "packedImages": 1,
    "documentBytes": 1,
    "packBytes": 1,
    "packIndexBytes": 28,
    "objects": 3,
    "storedBytes": 30
  },
  "documents": [{"path": "manifest.json", "bytes": 1, "sha256": "<SHA-256>"}],
  "packs": [{
    "path": "assets/pack-000.bin",
    "bytes": 1,
    "sha256": "<SHA-256>",
    "index": {
      "path": "indexes/pack-000.bin",
      "bytes": 28,
      "sha256": "<SHA-256>",
      "entries": 1
    }
  }]
}
```

The example count values are illustrative. The validator requires exact aggregate totals,
strictly sorted unique document paths, consecutive pack/index paths, and an inventory containing
every source file plus every derived index. `manifest.json` is a normal content object; the
separate `publication.json` is the server-side commit marker.
The `publication.json` path and the complete `indexes/` namespace are reserved for this control
plane and cannot appear as source documents. Object paths are canonical ASCII and at most 1024
bytes.

## MRPI v1 exact-range index

All integers are unsigned big-endian. The parser and encoder are exported by
`scripts/packed-image-authorization.mjs`.

| Byte range | Field |
|---|---|
| 0–3 | ASCII `MRPI` |
| 4–5 | version, exactly `1` |
| 6–7 | header length, exactly `20` |
| 8–11 | pack number |
| 12–15 | complete pack byte length |
| 16–19 | entry count |
| 20– | repeated 8-byte `(offset, length)` entries |

Entries are strictly contiguous, start at byte zero, and finish at the exact pack byte length.
The Worker authorizes a packed-image read only when its `(offset, length)` pair exactly matches
one MRPI entry. Membership is checked before R2 pack bytes are read.

## Authenticated, resumable upload

Use a dedicated least-privilege operator token. The CLI accepts it from
`CORE_DATASET_UPLOAD_TOKEN`, or from a plain mode-`0600` token file. It rejects credentials in
URLs and redacts the token from transport exceptions and logs. The Worker additionally requires
the temporary server-side `DATASET_ADMIN_ENABLED=true` feature gate; a missing gate disables core
ingestion and dataset-channel mutations before bearer-token authentication.

```bash
DATASET_ADMIN_ENABLED=true CORE_DATASET_UPLOAD_TOKEN='<operator-secret>' npm run upload:core-publication -- \
  --root /path/to/packed/exports \
  --publication /path/to/core-publication-bundle/publication.json \
  --ingest-base-url https://<app-origin>/api/admin/core-datasets \
  --concurrency 8
```

Protocol:

1. `POST /begin` stages the canonical control manifest.
2. `HEAD /object/<relative-path>` reuses an existing exact object.
3. `PUT /object/<relative-path>` writes a missing object with `If-None-Match: *`.
4. A second `HEAD` proves the stored byte length, SHA-256, and publication identity.
5. `POST /commit` asks the Worker to verify the complete R2 inventory and write
   `core/<publicationId>/publication.json` last.
6. `HEAD /status` must return `committed` plus the exact control-manifest digest and byte length.

Every request includes `X-MRT-Dataset-Publication-ID`. Object and control-manifest writes also
include `X-MRT-Content-SHA256`. Status responses are accepted only with exact
`X-MRT-Content-SHA256`, `X-MRT-Manifest-Bytes`, `X-MRT-Dataset-Publication-ID`, and
`X-MRT-Publication-State` metadata.

Interrupted uploads remain staged and invisible to public reads. Rerunning resumes exact
objects. HEAD consistency conflicts use a bounded 250/500/1000/2000 ms backoff and are logged;
a persistent conflict aborts before commit. Authentication, digest, size, inventory, or R2
errors are explicit and never fall back to static or older dataset bytes.

The R2 commit marker is written before the D1 registry transaction. Therefore a rerun always
replays the idempotent commit phase even when status already says `committed`; this reconciles a
missing registry row after an R2-success/D1-failure without rewriting any content object.

## Verify public delivery before channel activation

After commit, verify the same publication through its unauthenticated immutable delivery route:

```bash
npm run verify:core-publication-remote -- \
  --root /path/to/packed/exports \
  --publication /path/to/core-publication-bundle/publication.json \
  --base-url https://<app-origin>/dataset/publications \
  --concurrency 8
```

The verifier exhaustively re-derives the local export and MRPI bundle, sends a `HEAD` request for
every JSON record, downloads and compares `manifest.json` byte-for-byte, and compares the first,
middle, and last authorized image range in every pack against local bytes. The sample policy is
bounded to at most three small images per pack. Each pack's first image request still forces the
Worker to download, hash, and fully validate that pack's immutable MRPI authorization index
before it reads any R2 byte range.

## Activate and roll back mutable channel pointers

Channel activation and deactivation use the same server-only operator credential as core
ingestion, but they mutate only D1 pointers; immutable R2 publications are never deleted. The
operator verifies the resulting public catalog after accepting the Worker's exact mutation
receipt. It retries only the read-side verification with bounded backoff long enough to outwait the
public catalog's 60-second edge TTL, and never repeats an acknowledged mutation. The mutation
eagerly clears the current Cloudflare POP; another POP can expose the previous immutable channel
pointer for at most one TTL.

Before activation of a large publication, run the credential-free cold-browser gate documented in
the viewer README. A `current-storage-eligible` report is the only automatic pass. Exit status `2`
means either operator review or a lazy-index migration is required; it is not activation authority.
The benchmark uses the existing production web app and local publication bytes without uploading,
activating, deleting, or otherwise mutating D1/R2.

An exit status of `2` means the mutation was acknowledged as committed but all nine catalog
verification attempts remained inconclusive. Automation must stop and inspect `/api/datasets`;
it must not interpret status `2` as proof that the mutation was rolled back. Status `1` means the
operator did not accept a committed mutation receipt and assumes no catalog state.

Deactivation is compare-and-swap safe. The request must carry the exact current core publication
ID and preview asset-set ID. The Worker checks the pair and includes both identities in the
conditional D1 `DELETE`, so a stale or concurrent command cannot delete a repointed channel.

```bash
npm run deactivate:dataset-channel -- \
  --slug multiblock-madness \
  --publication-id <current-core-publication-sha256> \
  --preview-asset-set-id <current-preview-asset-set-sha256> \
  --admin-base-url https://<app-origin>/api/admin/dataset-channels \
  --token-file /private/path/dataset-operator-token
```
