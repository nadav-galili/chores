# ADR-0017 · Photo Proof lives in R2 for 30 days

Photo Proof image bytes live in a private Cloudflare R2 bucket, not Postgres. The API gives a Kid
Device a five-minute presigned `PUT` URL and chooses the object key itself:
`children/{child_id}/completions/{completion_id}`. The authenticated Device Token supplies the
child id, so request data cannot widen the object into another child's prefix. Parents receive a
five-minute presigned `GET` URL only after the API verifies that the Completion belongs to their
Household.

R2 deletes every object under `children/` after 30 days. `scripts/setup-r2.sh` creates the private
bucket, applies its CORS and lifecycle policies, creates bucket-scoped credentials and writes the
four runtime variables to Railway. The bootstrap Cloudflare token is never kept by the app.

Only the key is attached to a Completion. Photo bytes are not rows, never enter the Change Log and
never sync to a Kid Device. This keeps a private, short-lived proof artifact out of the durable
offline history while preserving the Completion as the record a Parent approves or rejects.
