# Design

The visual system for v1. Why it looks this way: ADR-0012. Vocabulary: `CONTEXT.md`. Tokens live in `apps/mobile/src/theme`, never in `packages/shared` — that workspace is zod schemas and correctness-critical pure logic, and a palette is neither.

Semantic names only. `colors.action`, `colors.growth`, `colors.coin` — never `colors.green`. No screen holds a literal colour.

## Palette

Two themes, the same tokens: the child's at full strength, the parent's desaturated for the evening admin pass.

| token | kid | parent | what it is for |
|---|---|---|---|
| ground | `#F2F6F1` | `#F5F7F5` | the page behind everything |
| surface | `#FFFFFF` | `#FFFFFF` | cards and rows standing on the ground |
| action | `#2F6B4F` | `#35594A` | the one colour that means "act": buttons, active chips, links |
| onAction | `#FFFFFF` | `#FFFFFF` | text and icons drawn on top of `action`, and nothing else |
| growth | `#8CBF9E` | `#A6BCAF` | the grove's living green — illustrations and growth affordances only |
| coin | `#E9B949` | `#C9A64E` | reserved: coin display and nothing else |
| text | `#1B2A22` | `#23302A` | primary text |
| muted | `#5F7168` | `#6C7A73` | secondary text, borders, placeholders |
| danger | `#B3261E` | `#9C3A33` | destructive actions and error copy |

Two rules the tokens cannot enforce on their own:

- **One green.** `action` is the only green in UI chrome. The grove's greens stay inside illustrations; `growth` never becomes a button. A "Done" button must not look like a tree — see ADR-0012 and ADR-0011 for why the two must not share a hue.
- **Coin gold is reserved.** No button, chip, badge or chrome element uses `coin`. Coins are the only thing on screen that colour means. The `Coins` primitive in `src/components/ui.tsx` is the only code that reads the token, so everything showing coins goes through it and nothing else can.

Spacing `4 / 8 / 12 / 16 / 24 / 32`; radius `8 / 12 / 16 / 24 / pill`. Both are frozen objects shared by every theme. Touch target is `48` in `big` and the parent theme, `56` in `little`: a size rather than a multiplier, because a target has a floor that type does not.

Light only. `userInterfaceStyle` is `"light"`; dark mode is deferred (ADR-0012).

## Type

One scale, shared by both modes. Line height is 1.3× the size, rounded.

| step | base | `little` (×1.15) | face |
|---|---|---|---|
| display | 34 | 39 | Rubik 600 |
| title | 26 | 30 | Rubik 600 |
| heading | 20 | 23 | system |
| body | 17 | 20 | system |
| label | 15 | 17 | system |
| caption | 13 | 15 | system |

`LITTLE_TYPE_MULTIPLIER = 1.15` is the single place `little` grows type — one number to tune after real child feedback, rather than two hand-maintained scales.

Rubik 600 is the only bundled face, and it carries display and title only; body stays on the system font. `docs/spec/04-milestones.md` has the reasoning. The weight lives in the face and no `fontWeight` rides along with it — pairing one with an explicitly named SemiBold family gets you synthetic bolding or a fallback on Android.

RTL is not a later pass. Hebrew is a tested locale from day one; every layout is built RTL-correct rather than mirrored afterwards.

## `little` vs `big`

Three differences, and only three:

1. **Type multiplier and touch-target size.** `little` is ×1.15 type and a 56-point target against 48. Both arrive through the theme, so no component knows `ui_mode` exists.
2. **Pet placement.** Above the list in `little`; collapsed into a header element in `big`.
3. **Copy voice.** Celebratory in `little`, neutral in `big`.

Explicitly not different: the set of screens, the number of chores shown at once, and the amount of motion. A 10-year-old still wants the pet to react — toning down the copy ages the app up, toning down the animation just makes it feel broken.

## Motion and haptics

Motion is spent on the done moment and nowhere else. In it: the chore row's transition to done, the coin count-up, the pet's reaction, and the tree growing on a day complete. Everything else is instant — screen transitions, list enter and exit, and the entire parent side. A parent scanning a list at 20:00 is not watching a performance.

Haptics are two events only: medium impact on a completion, success notification on a day complete. Nothing else. A device that buzzes on every tap stops meaning anything, and the stronger response is what makes finishing everything feel different from finishing one thing.

The done moment reads local state only and nothing in it awaits sync, so it completes with no network. That is a hard rule, not a best effort: the child's room being a dead spot must change nothing.

`react-native-reanimated`, `expo-haptics` and `expo-font` are approved for this work in `docs/spec/04-milestones.md`.

## Empty, error and offline states

Typographic by default: a line of copy and an action. No new illustrations, for the six parent-side and failure-side states or for anything else.

Two exceptions, both on the child's happy path, both reusing existing pet art at a mood rather than adding an asset:

- **No chores today** — a frozen day is a good day, not an error, and must not look like one.
- **Everything's done** — the end of the day is a moment worth reaching, not an empty list.

Offline is an inline strip, never a full-screen state. The app is offline-first; a blocking "You're offline" screen contradicts the product.

## Art

Twenty-one bundled assets — five pet bodies, three mood overlays, eight tree forms, the grove's ground, the icon set and the splash — all in one style, soft gouache botanical on the `ground` off-white. Every one of them is generated by hand from a prompt committed to `docs/design/prompts.md`, which is also where the model, seed and date of each render are recorded so a re-render in six months lands in the same style. That document holds the manifest, the filenames, the format and the style-validation pass; nothing about art production is duplicated here.
