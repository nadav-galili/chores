# Store listing

Name: **Mibo**. Bundle identifier and Android package: `com.mibokids.app`.

"Kids" appears in the identifier only, never in the brand. The store title and the icon on the child's phone say "Mibo": a 10-year-old is exactly the age at which being handed something labelled "Kids" reads as an insult, and she is half the M1 test. The identifier uses the compound because bare `mibo` is a crowded namespace — ten unrelated apps across both stores — while `mibokids` is empty on both.

The brand is child-facing and the keyword tail is parent-facing. A parent finds the app by searching "chores"; the icon on the child's phone says only "Mibo". No competitor names the child's side — all eight screened (Chorsee, Chores & Allowance Bot, Joon, Homey, S'moresUp, Greenlight, BusyKid, Sweepy) use parent-search vocabulary in the title, including Joon, whose product is itself a virtual pet.

## iOS

| field | value | chars |
|---|---|---|
| Title (30) | `Mibo: Chores Tracker` | 20 |
| Subtitle (30) | `Family Chore Chart & Allowance` | 30 |

No "Kids" in the subtitle, name, icon or screenshots: App Review rejected 1.0.1 under guideline 2.3.8 for `Chore Chart & Kids Allowance`, reading it as a claim the app is made for children, which ADR-0018 rules out. `kids` lives in the keyword field, which is never displayed.

Age rating: 4+, and every In-App Control is No. App Review rejected 1.0.1 under guideline 2.3.6 for "Parental Controls: Yes". The Parent PIN only gates leaving kid mode, so it is not a Parental Control in Apple's terms.

Keyword field (98 of 100, no spaces after commas):

```
behavior,reward,routine,task,kids,habit,star,job,checklist,pocket,money,daily,sticker,toddler,teen
```

Apple forms phrases across title, subtitle and keyword field, so nothing already in the first two is repeated here. This buys `behavior tracker`, `sticker chart`, `family chore chart`, `chores for kids`, `reward chart`, `daily routine`, `pocket money`, `chore checklist`. `app` is omitted — Apple indexes it anyway. `ADHD` is omitted deliberately: out of scope per `BUILD-PROMPT.md`, and Joon owns the term.

### Hebrew (`he`)

The Hebrew localization has its own title, subtitle and keyword field. In the Israel store, Mibo had 0 impressions in its first week (App Store Connect, 2026-11-03 to 2026-11-09), and the Hebrew terms have almost no competition: the top results for `מטלות בית`, `משימות לילדים`, `טבלת משימות` and `מטלות ודמי כיס` have 0 to 9 ratings (iTunes Search API, Israel, 2026-11-11).

| field | value | chars |
|---|---|---|
| Title (30) | `Mibo: מטלות בית, לוח משימות` | 27 |
| Subtitle (30) | `דמי כיס, פרסים, הרגלים למשפחה` | 29 |

Keyword field (100 of 100, no spaces after commas):

```
לילדים,ילדים,משפחה,רשימת,טבלת,חיזוקים,תורנות,מעקב,יומיות,יומי,התנהגות,שגרה,כוכבים,מדבקות,מתבגרים,פרס
```

- The App Store suggests these searches in Israel: `מטלות`, `מטלות בית`, `רשימת מטלות`, `לוח משימות`, `רשימת משימות`, `משימות יומיות`, `מעקב הרגלים`, `מעקב תורנות`. The three fields together make each of these phrases. They also make `מטלות לילדים`, `משימות לילדים`, `טבלת משימות`, `טבלת חיזוקים` and `דמי כיס`.
- No word is in two fields. Each important word is written without a prefix letter (`ו`, `ל`, `ה`), because it is not known that Apple removes Hebrew prefixes. `לילדים` and `ילדים` are two different words for the search, so the keyword field has the two.
- `ילדים` and `לילדים` are in the keyword field only. They are not in the title or the subtitle, for the same reason as `kids` in English (guideline 2.3.8, ADR-0018).
- `דמי כיס` is in the subtitle, not in the title, for the same reason as `Allowance` in English.

## Google Play

| field | value | chars |
|---|---|---|
| Title (30) | `Mibo: Chores Tracker for Kids` | 29 |
| Title, Hebrew `iw-IL` (30) | `Mibo: מטלות ודמי כיס לילדים` | 27 |

Play indexes the long description separately, so the title is the only short high-weight field and carries `for Kids`, which iOS keeps out of every displayed field (2.3.8) and puts in the keyword field.

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
