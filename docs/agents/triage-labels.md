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

## `ops`

`ops` marks a ticket that has all its acceptance criteria outside the repo (#75). Examples are a
RevenueCat offering, an App Store Connect product, a Cloudflare token and a hand-test on a physical
device. The code such a ticket needs already exists, or the ticket would not be `ops`.

Apply it at triage, and say in the issue body which dashboards are involved. An `ops` ticket can
also be `ready-for-agent`. The deliverable of the agent is then a wizard in `scripts/` that walks a
human through the clicks, not a diff against `apps/`. Use `scripts/setup-premium.sh` as the model
for the wizard.
