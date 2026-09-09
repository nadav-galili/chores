# Chores

A kids chores and allowance app where the child is the primary user. Parents set up chores and rewards; children complete chores on their own device, offline if needed, and are rewarded instantly.

## Language

### People

**Household**:
The unit of the product: one family, with its timezone, currency, entitlement, parents and children.
_Avoid_: Family, account, team

**Parent**:
An adult member of a household who authenticates with an identity provider and administers chores, rewards and money.
_Avoid_: Admin, user, guardian

**Child**:
A member of a household who completes chores. Identified only by first name; never has an email, password or identity-provider account.
_Avoid_: Kid (in code and docs; fine in UI copy), user, member

**Kid Device**:
A phone or tablet bound to exactly one child by redeeming a join code. Holds a device token scoped to that child.
_Avoid_: Child account, child login

**Join Code**:
A short-lived, single-use code a parent issues for one specific child, redeemed once by a kid device.
_Avoid_: Invite, pairing code, PIN

**Device Token**:
The long-lived credential a kid device holds after redeeming a join code, scoped to one household and one child. Revocable by a parent.
_Avoid_: Session, child JWT, login token

**Parent PIN**:
The short code a parent enters to leave kid mode on a device.

### Chores

**Chore**:
A parent-defined task with a recurrence and one or more assigned children.
_Avoid_: Task, job, todo

**Assignee**:
A child a chore is assigned to. A chore with several assignees produces one instance per assignee per day.

**Instance**:
A single occurrence of a chore for one child on one chore date. What the child actually sees and completes.
_Avoid_: Occurrence, task, chore item

**Chore Date**:
The household-local calendar day an instance belongs to, derived from the household timezone and day boundary. Never a UTC date.
_Avoid_: Due date (reserved for one-off chores), day, date

**Day Boundary**:
The household-local hour at which one chore date ends and the next begins. Default midnight; may be moved to early morning so late completions count for the same day.
_Avoid_: Reset time, cutoff, day end

**Completion**:
The record that a child marked an instance done. Counts immediately; may later be rejected by a parent.
_Avoid_: Check-off, approval, submission

**Rejection**:
A parent's after-the-fact decision that a completion does not count. Returns the instance to due, marked as needing a redo, and claws back what it earned.
_Avoid_: Decline, undo, veto

**Redo**:
The state of an instance whose completion was rejected and which the child may complete again.

**Photo Proof**:
A chore setting requiring a photo with the completion; the only case where earning waits for parent approval.

### Reward loop

**Coins**:
The spendable currency a child earns from completions and bonuses and spends in the reward shop.
_Avoid_: Points, stars, money

**XP**:
Non-spendable experience earned alongside coins that drives the pet's level. Never traded for anything.
_Avoid_: Pet points, level points

**Pet**:
The child's companion character whose mood reflects today's completions and whose level reflects XP.
_Avoid_: Avatar, buddy, mascot

**Day Complete**:
A chore date on which every instance due for a child was completed. Earns the daily bonus and advances the streak.
_Avoid_: All done, perfect day

**Frozen Day**:
A chore date with no instances due for a child. Neither breaks nor extends the streak.

**Streak**:
The number of consecutive chore dates, ignoring frozen days, that were day complete for a child.

**Grove**:
The cumulative record of a household's effort: one tree per child, standing in a shared grove. Grows only; never shrinks.
_Avoid_: Garden, forest, world, map

**Tree**:
One child's growth within the grove. Its stage is the count of that child's growth entries.
_Avoid_: Plant, sapling, progress bar

**Growth Entry**:
An append-only row appended when a chore date is day complete for a child, with id `uuid5('grow', child_id, chore_date)`. Never updated, never deleted, and never reversed — there is no clawback counterpart. (ADR-0011)
_Avoid_: Growth event, tree row, day record

**Grove Stage**:
A child's tree stage, always `COUNT(*)` of their growth entries. Never a stored column.
_Avoid_: Tree level, growth count, progress

**Bonus**:
Coins and XP granted beyond per-chore earnings: the daily bonus for day complete and streak bonuses at milestone lengths.

**Ledger Entry**:
An append-only, signed record of coins (and optionally money) moving for a child. A child's balance is the sum of their entries.
_Avoid_: Transaction, balance update, points record

**Clawback**:
A ledger entry that exactly reverses an earlier entry after a rejection. History is never edited.
_Avoid_: Deduction, penalty, refund

**Reward**:
Something a child can request with coins. Built-in rewards ship with the app; custom rewards are parent-defined.
_Avoid_: Prize, item, goal

**Redemption**:
A child's request to exchange coins for a reward, decided by a parent. Coins are reserved while requested and deducted on approval.
_Avoid_: Purchase, order, claim

**Payout**:
A parent converting a child's coins into real money owed, recorded in the ledger. No money moves through the app.
_Avoid_: Cash out, transfer, allowance payment

**Allowance**:
The money side of the ledger: the household's coin-to-currency rate and the payouts recorded against it.

### Commercial

**Entitlement**:
Whether a household is on the free tier or premium. Enforced by the server; the app only hides gated controls.
_Avoid_: Plan, subscription status, tier (use "free tier" / "premium" for the values)

**Gate**:
A specific action that requires premium. The paywall is shown only when a gate is hit.
_Avoid_: Paywall trigger, upsell point

**Read-only Child**:
A child beyond the free tier's quota after the grace period; still uses the app fully, but parents cannot edit that child's chores until premium.

### Sync

**Op**:
A single intent recorded on a device (complete, reject, upsert chore, ...) and replayed to the server exactly once.
_Avoid_: Mutation, action, event

**Outbox**:
The device-local queue of ops not yet acknowledged by the server.

**Change Log**:
The server's ordered record of row changes that devices pull from, scoped to what that device may see.

**Digest**:
The single evening notification summarising a household's day for a parent. The app never sends per-event notifications to parents.
