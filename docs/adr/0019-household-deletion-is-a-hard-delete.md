# Household deletion is a hard delete, triggered by the last parent

Google Play requires an in-app path and a web URL for deleting an account. A parent's account deletion removes that parent only; while a Partner remains, the household, its children and all their history live on. When the last parent deletes their account, the whole household is hard-deleted — children, ledger, grove, completions, photos and every kid device's token — and a kid device learns it on its next `/sync`. The append-only rules of ADR-0002 and ADR-0011 govern the history of a living household; they do not oblige us to keep a household nobody can sign into, and keeping it would contradict the privacy policy's promise to delete on request.

## Consequences

- Deletion does not cancel a store subscription; the confirmation screen tells the parent to cancel in Google Play or the App Store first. A later RevenueCat webhook for a deleted household is acknowledged and dropped.
- The web path is a request form on `mibokids.app/delete-account`, handled by hand; the in-app path is the self-serve one.
