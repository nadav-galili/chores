---
status: accepted
---
# Mibo ships outside the Kids Category

App Store Connect asks this on step 7 of the age-rating questionnaire, as an "Age Categories and Override" radio: Not Applicable, Made for Kids, or Override to Higher Age Rating. Mibo answers Not Applicable. The answer is an ADR rather than a form field because it cannot be taken back: once a version is approved inside the Kids Category, leaving it is a new app, and the reverse — joining later — is a form change. The cheap direction is the one that stays out.

The blocker is guideline 1.3, which forbids a Kids Category app from sending personally identifiable information or device information to third parties. A Kid Device runs two third-party SDKs. PostHog sends the three properties ADR-0009 allows it — interface mode, a broad age band, a one-way hash of the household id — plus the device's platform and language, under a random per-device id. Sentry is worse in exactly the way that matters here: ADR-0015 records, as a known and accepted gap, that a hard native crash is written to disk and sent by the native SDK **before `beforeSend` runs**, carrying a stack trace and device context that our allowlist never sees. An allowlist that a crash can outrun is not a 1.3 defence. Nothing about that is fixable in the store listing; it is fixable only by taking both SDKs off the Kid Device, and both of them are there for reasons — a failure on a kid device is invisible, which is the whole argument of ADR-0015.

The second reason is smaller but points the same way. The Kids Category requires an age band, and the bands stop at 9–11. The keyword field in `docs/spec/05-store-listing.md` deliberately buys `teen`, and the product's own test household has a 10-year-old who will not be 11 forever. Declaring 9–11 to Apple while bidding on `teen` is a contradiction a reviewer can read off two screens of the same record.

What staying out costs is guideline 2.3.8, on metadata that markets to children from outside the category. The subtitle is `Chore Chart & Kids Allowance`, and "Kids" in it is the exposed surface. That is a rejection we can answer rather than a rule we break: `scripts/setup-store-listing.sh` carries `Chore Chart & Family Allowance` (30 of 30) as a prepared replacement, and the description and screenshots are written for the parent who buys rather than the child who uses — which is what `docs/spec/05-store-listing.md` already says the store surface is for. The brand takes no damage: "Kids" was never in the brand, only in the identifier (`com.mibokids.app`).

None of this weakens what the app actually does about children. They still have no accounts (ADR-0001), are still anonymous in analytics (ADR-0009), and the privacy labels still declare nothing used for tracking. The Kids Category is a distribution choice, not the privacy posture; conflating the two is what would make this decision look like a retreat.

To revisit: strip Sentry and PostHog from the Kid Device build, or gate them behind a parent-only initialisation that a Kid Device never reaches, then re-read ADR-0015's native-crash gap to check it has actually closed. Until that is true, answering Made for Kids would be declaring something the code does not do.

## Google Play

Play has no Kids Category; its equivalent is the Target audience form, where any age group under 13 puts the app under the Families policy, whose SDK rules fail on the same two SDKs for the same reason. Mibo declares **18+ only** and answers that the app is for parents. The exposed surface is Play's "could your app unintentionally appeal to children?" check, since the product is a pet, a grove and coins, and the Play title carries `for Kids`. The defence is the one iOS uses for 2.3.8: the listing copy and the first screenshots lead with the Parent side (setup, approvals, allowance), and the title's prepared fallback is `Mibo: Chores Tracker` (20). If Play forces Families anyway, that is the "to revisit" above, not a form change.
