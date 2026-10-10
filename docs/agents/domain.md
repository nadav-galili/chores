# Domain Docs

How to read the domain docs of this repo.

## Before exploring, read these

- **`CONTEXT.md`**: the glossary. A skill that names `GLOSSARY.md` means this file.
- **`docs/adr/`**: the settled decisions. The filename of an ADR names its area. Read each ADR whose area you change.
- **`docs/spec/`**: the approved design. `docs/spec/README.md` names the file for each area. Read the file for the area that you change.

## Use the glossary's vocabulary

When you name a domain concept (in code, a test name, an issue title, a refactor proposal, a hypothesis), use the `CONTEXT.md` term verbatim. If you have a synonym that an entry lists under `_Avoid_`, use the term of that entry.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

An ADR can look wrong without its context. It is settled: follow it. The product constraints in `BUILD-PROMPT.md` are settled in the same way.

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0011 (the grove is append-only), but worth reopening because…_
