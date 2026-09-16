# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |
| —                          | `ops`                | No code to write: credentials, dashboards, store config |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## `ops`

`ops` has no counterpart in the skills' vocabulary; it is ours. It marks a ticket whose acceptance
criteria are all satisfied outside the repo — a RevenueCat offering, an App Store Connect product, a
Cloudflare token, a hand-test on a physical device. The code such a ticket needs already exists, or
the ticket would not be `ops`.

Apply it at triage, and say in the issue body which dashboards are involved. It is orthogonal to
`ready-for-agent`: an `ops` ticket can still be agent-ready, because the agent's deliverable is a
script in `scripts/` that walks a human through the clicking, not a diff against `apps/`.

It exists because #75 read like four sections of implementation work and was none, and the only way
to learn that was to read the four files it touched and find them already finished.
