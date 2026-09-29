# Store listing

Name: **Mibo**. Bundle identifier and Android package: `com.mibokids.app`.

"Kids" appears in the identifier only, never in the brand. The store title and the icon on the child's phone say "Mibo": a 10-year-old is exactly the age at which being handed something labelled "Kids" reads as an insult, and she is half the M1 test. The identifier uses the compound because bare `mibo` is a crowded namespace — ten unrelated apps across both stores — while `mibokids` is empty on both.

The brand is child-facing and the keyword tail is parent-facing. A parent finds the app by searching "chores"; the icon on the child's phone says only "Mibo". No competitor names the child's side — all eight screened (Chorsee, Chores & Allowance Bot, Joon, Homey, S'moresUp, Greenlight, BusyKid, Sweepy) use parent-search vocabulary in the title, including Joon, whose product is itself a virtual pet.

## iOS

| field | value | chars |
|---|---|---|
| Title (30) | `Mibo: Chores Tracker` | 20 |
| Subtitle (30) | `Chore Chart & Kids Allowance` | 28 |

Keyword field (100 of 100, no spaces after commas):

```
behavior,reward,routine,task,family,habit,star,job,checklist,pocket,money,daily,sticker,toddler,teen
```

Apple forms phrases across title, subtitle and keyword field, so nothing already in the first two is repeated here. This buys `behavior tracker`, `sticker chart`, `family chore chart`, `chores for kids`, `reward chart`, `daily routine`, `pocket money`, `chore checklist`. `app` is omitted — Apple indexes it anyway. `ADHD` is omitted deliberately: out of scope per `BUILD-PROMPT.md`, and Joon owns the term.

## Google Play

| field | value | chars |
|---|---|---|
| Title (30) | `Mibo: Chores Tracker for Kids` | 29 |

Play indexes the long description separately, so the title is the only short high-weight field and carries `for Kids` that iOS puts in the subtitle.

Short and full descriptions, English and Hebrew (`iw-IL`), live in `docs/store/listing.md`.

- **Target audience:** 18+ only, answered as an app for parents (ADR-0018). The listing copy and the first screenshots lead with the Parent side.
- **Products:** one subscription `premium` with base plans `monthly` ($6.99) and `annual` ($39.99), no offers; one one-time product `premium_lifetime` ($79.99). RevenueCat offering `default` packages them as MONTHLY, ANNUAL and LIFETIME onto entitlement `premium`. Real-time developer notifications feed RevenueCat, which stays the only entitlement writer (ADR-0016).
- **Screenshots:** English only, phone and 7" and 10" tablet, captured on Android emulators and captioned in the iOS style; the Hebrew listing falls back to them. Plus a 1024×500 feature graphic.
- **Account deletion:** in the app, from the Parent's own signed-in settings; on the web, a request form at `https://mibokids.app/delete-account` handled by hand (ADR-0019).
- **Release:** the account is personal, so Production is unlocked only after a closed test with at least 12 testers opted in for 14 continuous days. The closed test runs the `production` build that is later promoted unchanged.

## Target keywords

AppTweak volume, US iPhone: `chores tracker` 47, `chores` 43, `chore chart` 41, `kids chore app` 34, `chores and allowance` 34, `chore app` 33, `behavior tracker` 31, `chores app` 30, `chores for kids` 27, `kids chores` 25.

`allowance` sits in the subtitle rather than the title, and is phrased as a ledger rather than as money. The category leader made the same move: Chorsee's US title was `Chorsee: Chores and Allowance` and is now `Chorsee: Chores Tracker`, with "Allowance" demoted. Promote it only once payouts actually ship — a money promise the app cannot keep is a documented source of 1★ reviews from children.

## Constraints on changes

The **title is a growth lever** and is expected to change with ASO iteration; keep "Mibo" short enough that a longer keyword phrase still fits 30. The **bundle id is not** — it is fixed once the first build reaches either store.

## Outstanding

- ~~`mibokids.app` is unregistered~~ — registered at Cloudflare, and since #84 it is the API's own hostname: `https://mibokids.app` serves the landing page, the privacy policy and the terms of service, and is what the store's Privacy Policy and Support URLs point at. (`mibo.app` was $8,999 BIN on Afternic — not needed under this identifier.)
- A trademark clearance search on MIBO before first store submission. The screen found zero live US class 9 or 42 registrations and no in-niche store collision, but TMview is not an official register and absence of a hit is not clearance.
- Icons and the pet's placeholder art.
