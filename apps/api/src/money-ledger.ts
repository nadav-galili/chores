import { adjustEntry, balanceOf, owedOf, requestPayout } from '@chores/shared';
import { and, asc, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from './db/client.ts';
import { children, households, ledgerEntries } from './db/schema.ts';
import { gate } from './gate.ts';
import { ledgerRow } from './ledger-row.ts';
import { parseBody } from './parse-body.ts';
import { householdScope, type ScopedEnv } from './scope.ts';

const settingsSchema = z.object({ coins_per_unit: z.number().int().positive() }).strict();
const payoutSchema = z
  .object({
    id: z.string().uuid(),
    child_id: z.string().uuid(),
    coins: z.number().int().positive(),
  })
  .strict();
const adjustmentSchema = z
  .object({
    id: z.string().uuid(),
    child_id: z.string().uuid(),
    coins: z
      .number()
      .int()
      .refine((coins) => coins !== 0),
    note: z.string().trim().min(1).max(500),
  })
  .strict();

type LedgerRow = typeof ledgerEntries.$inferSelect;

const toApi = (row: LedgerRow) => ({
  id: row.id,
  household_id: row.householdId,
  child_id: row.childId,
  kind: row.kind,
  coins: row.coins,
  money_amount: row.moneyAmount,
  note: row.note,
  ref_type: row.refType,
  ref_id: row.refId,
  created_at: row.createdAt.toISOString(),
  created_by: row.createdBy,
});

const gateMoneyLedger = (db: Db, householdId: string) =>
  gate(db, 'money_ledger', {
    householdId,
    now: new Date().toISOString(),
    child_count: 0,
    parent_count: 0,
  });

/** Parent-only allowance settings, per-child balances, and append-only money ledger writes. */
export function moneyLedgerRoutes(db: Db) {
  const app = new Hono<ScopedEnv>();
  app.use('/households/:householdId/money-ledger', householdScope(db));
  app.use('/households/:householdId/money-ledger/*', householdScope(db));

  app.get('/households/:householdId/money-ledger', async (c) => {
    const householdId = c.get('householdId');
    const allowed = await gateMoneyLedger(db, householdId);
    if (allowed instanceof Response) return allowed;

    const [household, childRows, entryRows] = await Promise.all([
      db.query.households.findFirst({ where: eq(households.id, householdId) }),
      db
        .select({ id: children.id })
        .from(children)
        .where(eq(children.householdId, householdId))
        .orderBy(asc(children.sort)),
      db
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.householdId, householdId))
        .orderBy(desc(ledgerEntries.createdAt), desc(ledgerEntries.id)),
    ]);
    if (!household) return c.json({ error: 'not_found' }, 404);

    return c.json({
      currency: household.currency,
      coins_per_unit: household.coinsPerUnit,
      children: childRows.map((child) => {
        const entries = entryRows.filter((entry) => entry.childId === child.id);
        return {
          child_id: child.id,
          balance: balanceOf(entries),
          owed: owedOf(entries.map((entry) => ({ money_amount: entry.moneyAmount }))),
          entries: entries.map(toApi),
        };
      }),
    });
  });

  app.patch('/households/:householdId/money-ledger', async (c) => {
    const householdId = c.get('householdId');
    const allowed = await gateMoneyLedger(db, householdId);
    if (allowed instanceof Response) return allowed;
    const body = await parseBody(c, settingsSchema);
    if (!body.ok) return body.response;

    const [household] = await db
      .update(households)
      .set({ coinsPerUnit: body.data.coins_per_unit })
      .where(eq(households.id, householdId))
      .returning({ currency: households.currency, coinsPerUnit: households.coinsPerUnit });
    if (!household) return c.json({ error: 'not_found' }, 404);
    return c.json({ currency: household.currency, coins_per_unit: household.coinsPerUnit });
  });

  app.post('/households/:householdId/money-ledger/payout', async (c) => {
    const householdId = c.get('householdId');
    const allowed = await gateMoneyLedger(db, householdId);
    if (allowed instanceof Response) return allowed;
    const body = await parseBody(c, payoutSchema);
    if (!body.ok) return body.response;
    const parentId = c.get('parentId');

    const result = await db.transaction(async (tx) => {
      // All payout writers lock the child before reading SUM(coins). That makes two parents'
      // payouts one ordering, including when the ledger is empty and there are no rows to lock.
      const [child] = await tx
        .select({ id: children.id })
        .from(children)
        .where(and(eq(children.id, body.data.child_id), eq(children.householdId, householdId)))
        .for('update');
      if (!child) return { kind: 'not_found' } as const;

      const [existing] = await tx
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.id, body.data.id));
      if (existing) {
        return existing.householdId === householdId &&
          existing.childId === body.data.child_id &&
          existing.kind === 'payout' &&
          existing.coins === -body.data.coins
          ? ({ kind: 'retry', row: existing } as const)
          : ({ kind: 'id_conflict' } as const);
      }

      const [household, rows] = await Promise.all([
        tx.query.households.findFirst({ where: eq(households.id, householdId) }),
        tx
          .select({ coins: ledgerEntries.coins })
          .from(ledgerEntries)
          .where(eq(ledgerEntries.childId, child.id)),
      ]);
      if (!household) return { kind: 'not_found' } as const;
      const now = new Date();
      const payout = requestPayout({
        id: body.data.id,
        household_id: householdId,
        child_id: child.id,
        coins: body.data.coins,
        coins_per_unit: household.coinsPerUnit,
        balance: balanceOf(rows),
        created_at: now.toISOString(),
        created_by: parentId,
      });
      if (!payout.ok) return { kind: 'insufficient_coins' } as const;
      const [row] = await tx
        .insert(ledgerEntries)
        .values(ledgerRow(payout.entry, now))
        .onConflictDoNothing()
        .returning();
      if (row) return { kind: 'created', row } as const;
      // UUIDs are global. A concurrent request for another child can race this child's lock; the
      // unique constraint decides, then this request reports the collision instead of becoming a
      // server error.
      const [conflict] = await tx
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.id, body.data.id));
      return conflict?.householdId === householdId &&
        conflict.childId === child.id &&
        conflict.kind === 'payout' &&
        conflict.coins === -body.data.coins
        ? ({ kind: 'retry', row: conflict } as const)
        : ({ kind: 'id_conflict' } as const);
    });

    if (result.kind === 'not_found') return c.json({ error: 'not_found' }, 404);
    if (result.kind === 'id_conflict') return c.json({ error: 'id_conflict' }, 409);
    if (result.kind === 'insufficient_coins') {
      return c.json({ error: 'insufficient_coins' }, 409);
    }
    return c.json(toApi(result.row), result.kind === 'created' ? 201 : 200);
  });

  app.post('/households/:householdId/money-ledger/adjust', async (c) => {
    const householdId = c.get('householdId');
    const allowed = await gateMoneyLedger(db, householdId);
    if (allowed instanceof Response) return allowed;
    const body = await parseBody(c, adjustmentSchema);
    if (!body.ok) return body.response;
    const parentId = c.get('parentId');

    const result = await db.transaction(async (tx) => {
      const [child] = await tx
        .select({ id: children.id })
        .from(children)
        .where(and(eq(children.id, body.data.child_id), eq(children.householdId, householdId)))
        .for('update');
      if (!child) return { kind: 'not_found' } as const;
      const [existing] = await tx
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.id, body.data.id));
      if (existing) {
        return existing.householdId === householdId &&
          existing.childId === child.id &&
          existing.kind === 'adjust' &&
          existing.coins === body.data.coins &&
          existing.note === body.data.note
          ? ({ kind: 'retry', row: existing } as const)
          : ({ kind: 'id_conflict' } as const);
      }

      const now = new Date();
      const entry = adjustEntry({
        id: body.data.id,
        household_id: householdId,
        child_id: child.id,
        coins: body.data.coins,
        note: body.data.note,
        created_at: now.toISOString(),
        created_by: parentId,
      });
      const [row] = await tx
        .insert(ledgerEntries)
        .values(ledgerRow(entry, now))
        .onConflictDoNothing()
        .returning();
      if (row) return { kind: 'created', row } as const;
      const [conflict] = await tx
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.id, body.data.id));
      return conflict?.householdId === householdId &&
        conflict.childId === child.id &&
        conflict.kind === 'adjust' &&
        conflict.coins === body.data.coins &&
        conflict.note === body.data.note
        ? ({ kind: 'retry', row: conflict } as const)
        : ({ kind: 'id_conflict' } as const);
    });

    if (result.kind === 'not_found') return c.json({ error: 'not_found' }, 404);
    if (result.kind === 'id_conflict') return c.json({ error: 'id_conflict' }, 409);
    return c.json(toApi(result.row), result.kind === 'created' ? 201 : 200);
  });

  return app;
}
