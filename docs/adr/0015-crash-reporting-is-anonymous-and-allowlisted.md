---
status: accepted
---
# Sentry for crashes, with an allowlisted payload and no child identity

A failure on a kid device is invisible: there is nobody there to read an error, and the app's one
known-silent `catch` cost an instrumented local build and a physical device run to diagnose (#35,
#36). PostHog error tracking was the cheaper option — already a dependency, already wired — but it
does not capture native crashes and does not symbolicate a release bundle, which is most of what
was missing. `@sentry/react-native` is approved for the mobile app and added to the list in
`docs/spec/04-milestones.md`; the API keeps `posthog-node` and Railway logs, because a server-side
error carries no child identity by construction.

Three rules make that safe, and they are the reason this is an ADR rather than a dependency bump:

**The payload is an allowlist, not a scrub list.** `packages/shared/src/error-reporting.ts` rebuilds
every event and every breadcrumb out of named fields. A deny list is a list of the leaks somebody
remembered; the next SDK release adds a field nobody remembered and it ships. Console breadcrumbs
are dropped outright, request and navigation breadcrumbs keep a method, a status and a path whose
dynamic segments are starred, and `device.name` — whatever the owner typed into Android settings,
routinely a first name — does not survive.

**A kid device has no identity at all.** No user is set, and the tags are the same three properties
ADR-0009 already allows a kid device to say about itself: ui mode, age band, hashed household. A
child is not an identity provider user (ADR-0001), and minting a stable child id so crash reports
could be grouped would work around that ADR rather than respect it. A parent is identified by their
Clerk id and nothing else — the same identity analytics uses.

**What the scrubber cannot reach is an error's own message.** A `throw` that interpolates a chore
title puts it in the stack trace, where no downstream filter can tell it from a real error string.
That is a rule about how errors are written, so it lives in `CODING_STANDARDS.md` too.

Two gaps are known and accepted. A hard native crash is written to disk and sent by the native SDK
without passing through `beforeSend`, so it is not rebuilt — it carries a stack trace and device
context and nothing of ours, and `sendDefaultPii: false` plus `attachScreenshot: false` are what
hold that true. And a lowercase path segment is indistinguishable from a route name, so `/pet/pip`
would survive; nothing a child or a parent typed may be put in a path in the first place.

Nothing initialises in development. Session replay is off and stays off: it would film a child's
screen. Tracing is off. The DSN is build-time config, supplied like the other `EXPO_PUBLIC_*`
values but not committed.
