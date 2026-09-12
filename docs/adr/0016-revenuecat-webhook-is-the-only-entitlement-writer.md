---
status: accepted
---
# The RevenueCat webhook is the only writer of a household's entitlement

Every premium Gate reads `households.entitlement`, so whoever can write that column can bypass
every paid boundary. A phone is controlled by its owner: an app response, a local purchase record
or a receipt reported by the device is evidence for the UI, not authority for the server. The
server moves the Entitlement only after RevenueCat sends a webhook whose HMAC covers the exact raw
request body. This costs a short visible lag after checkout. The parent app waits for the server's
household payload to turn premium rather than granting access from the device's own result.

RevenueCat is told the purchasing Parent's Clerk user id. A webhook resolves `app_user_id`,
`original_app_user_id` and `aliases` against `parents`, then updates that Parent's household. The
Entitlement belongs to the Household, not the purchaser, so a Partner sees the same premium value
without restoring or buying it again. No child identifier or child data is sent to RevenueCat or
to the server-side `purchase_completed` analytics event (ADR-0009).

Authenticated deliveries are stored whole in `revenuecat_events`. RevenueCat keeps an event id
stable across retries; that id is the primary key, and inserting the event plus updating the
Household happens in one transaction. A duplicate therefore returns success and changes nothing,
including analytics. The event timestamp prevents a delayed older delivery from replacing newer
state.

`INITIAL_PURCHASE` and `RENEWAL` grant premium. `CANCELLATION` leaves access in place until
`EXPIRATION`, because cancellation normally turns off renewal rather than ending the paid period.
`PRODUCT_CHANGE` stays premium under the new product. `EXPIRATION` returns the Household to free.
A `NON_RENEWING_PURCHASE` with no expiry is the lifetime product: its source is recorded as
`revenuecat:lifetime:<product_id>`, and a later subscription expiration cannot lapse it. Events
that do not name RevenueCat's `premium` entitlement are recorded but cannot grant access. Lifetime
has no natural expiry, but RevenueCat may cancel a non-renewing purchase when it is refunded; a
`CANCELLATION` with no expiry revokes it.

The signing secret is server-only configuration. Missing, malformed, stale or mis-signed
requests are refused and logged before JSON parsing and before any database write. The five-minute
signature timestamp tolerance is for delivery latency and clock skew; replay safety after that is
the event id's job.
