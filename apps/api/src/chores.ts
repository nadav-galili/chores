import {
  applyChoreOp,
  choreCreated,
  upsertChoreOpSchema,
  writerClockSchema,
  type ChoreClocks,
  type ChoreState,
} from '@chores/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Analytics } from './analytics.ts';
import type { Db } from './db/client.ts';
import { children, choreAssignees, chores } from './db/schema.ts';
import { gate } from './gate.ts';
import { parseBody } from './parse-body.ts';
import { choreFieldsFromRow, choreToApi } from './serialize.ts';
import { householdScope, type ScopedEnv } from './scope.ts';

type ChoreRow = typeof chores.$inferSelect;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const deleteChoreOpSchema = z.object({ updated_at: writerClockSchema });

const stateOf = (row: ChoreRow, assignees: string[]): ChoreState => ({
  fields: choreFieldsFromRow(row, assignees),
  clocks: row.fieldClocks,
});

/** The columns every landed write moves: version up by one, the row clock forward, the writer. */
const stamp = (existing: ChoreRow, opAt: Date, parentId: string) => ({
  version: sql`${chores.version} + 1`,
  updatedAt: opAt > existing.updatedAt ? opAt : existing.updatedAt,
  updatedBy: parentId,
});

const assigneesOf = async (tx: Tx, choreId: string) =>
  (
    await tx
      .select({ childId: choreAssignees.childId })
      .from(choreAssignees)
      .where(eq(choreAssignees.choreId, choreId))
  ).map((r) => r.childId);

/** Locks the chore row for the rest of the transaction; null when it does not exist. */
async function lockChore(tx: Tx, choreId: string) {
  const [row] = await tx.select().from(chores).where(eq(chores.id, choreId)).for('update');
  return row ?? null;
}

/** Routes for a signed-in parent to manage the household's chores. */
export function choreRoutes(db: Db, analytics: Analytics) {
  const app = new Hono<ScopedEnv>();
  app.use('/households/:householdId/*', householdScope(db));

  app.get('/households/:householdId/chores', async (c) => {
    const householdId = c.get('householdId');
    const rows = await db
      .select()
      .from(chores)
      .where(and(eq(chores.householdId, householdId), isNull(chores.deletedAt)))
      .orderBy(chores.title);
    const ids = rows.map((r) => r.id);
    const assigneeRows = ids.length
      ? await db.select().from(choreAssignees).where(inArray(choreAssignees.choreId, ids))
      : [];
    return c.json(
      rows.map((row) =>
        choreToApi(
          row,
          assigneeRows.filter((a) => a.choreId === row.id).map((a) => a.childId),
        ),
      ),
    );
  });

  // `upsert_chore`: create when the id is new, otherwise merge field by field (last writer wins).
  app.put('/households/:householdId/chores/:choreId', async (c) => {
    const body = await parseBody(c, upsertChoreOpSchema);
    if (!body.ok) return body.response;
    const householdId = c.get('householdId');
    const parentId = c.get('parentId');
    const choreId = c.req.param('choreId');
    if (!z.string().uuid().safeParse(choreId).success) return c.json({ error: 'not_found' }, 404);

    const result = await db.transaction(async (tx) => {
      const existing = await lockChore(tx, choreId);
      if (existing && existing.householdId !== householdId) return { status: 404 as const };
      const before = existing ? stateOf(existing, await assigneesOf(tx, choreId)) : null;
      const merged = applyChoreOp(before, body.data);
      if (!merged.ok)
        return { status: 400 as const, error: 'invalid_chore', issues: merged.issues };

      if (merged.changed.includes('assignees')) {
        const previous = before?.fields.assignees ?? [];
        const affected = [
          ...previous.filter((id) => !merged.fields.assignees.includes(id)),
          ...merged.fields.assignees.filter((id) => !previous.includes(id)),
        ];
        const known = await tx
          .select({ id: children.id })
          .from(children)
          .where(
            and(
              eq(children.householdId, householdId),
              inArray(children.id, merged.fields.assignees),
            ),
          );
        if (known.length !== new Set(merged.fields.assignees).size) {
          return { status: 400 as const, error: 'unknown_assignee' };
        }
        if (affected.length) {
          const affectedChildren = await tx
            .select({ readOnlyAfter: children.readOnlyAfter })
            .from(children)
            .where(and(eq(children.householdId, householdId), inArray(children.id, affected)));
          for (const child of affectedChildren) {
            const answer = await gate(tx, 'edit_child', {
              householdId,
              now: new Date().toISOString(),
              child_count: 0,
              parent_count: 0,
              child: { read_only_after: child.readOnlyAfter?.toISOString() ?? null },
            });
            if (answer instanceof Response) return answer;
          }
        }
      }

      const fields = merged.fields;
      const columns = {
        title: fields.title,
        icon: fields.icon,
        kind: fields.kind,
        weekdayMask: fields.weekday_mask,
        startDate: fields.start_date,
        endDate: fields.end_date,
        dueDate: fields.due_date,
        requiresPhoto: fields.requires_photo,
        fieldClocks: merged.clocks as ChoreClocks,
      };
      const opAt = new Date(body.data.updated_at);

      if (!existing) {
        const [row] = await tx
          .insert(chores)
          .values({ ...columns, id: choreId, householdId, updatedAt: opAt, updatedBy: parentId })
          .returning();
        await tx
          .insert(choreAssignees)
          .values(fields.assignees.map((childId) => ({ choreId, childId })));
        return { status: 201 as const, chore: choreToApi(row!, fields.assignees) };
      }

      if (merged.changed.length === 0) {
        return { status: 200 as const, chore: choreToApi(existing, before!.fields.assignees) };
      }
      const [row] = await tx
        .update(chores)
        .set({ ...columns, ...stamp(existing, opAt, parentId) })
        .where(eq(chores.id, choreId))
        .returning();
      if (merged.changed.includes('assignees')) {
        const was = before!.fields.assignees;
        const removed = was.filter((id) => !fields.assignees.includes(id));
        const added = fields.assignees.filter((id) => !was.includes(id));
        if (removed.length) {
          await tx
            .delete(choreAssignees)
            .where(
              and(eq(choreAssignees.choreId, choreId), inArray(choreAssignees.childId, removed)),
            );
        }
        if (added.length) {
          await tx.insert(choreAssignees).values(added.map((childId) => ({ choreId, childId })));
        }
      }
      return { status: 200 as const, chore: choreToApi(row!, fields.assignees) };
    });

    if (result instanceof Response) return result;
    if (result.status === 404) return c.json({ error: 'not_found' }, 404);
    if (result.status === 400) {
      return c.json({ error: result.error, issues: result.issues ?? [] }, 400);
    }
    // Activation is the chore existing at all: a later edit to it is not another one.
    if (result.status === 201) {
      analytics.capture({
        distinctId: c.get('clerkUserId'),
        event: choreCreated({
          kind: result.chore.kind,
          assignee_count: result.chore.assignees.length,
        }),
        groups: { household: householdId },
      });
    }
    return c.json(result.chore, result.status);
  });

  // `delete_chore`: soft delete; the row and its history stay.
  app.delete('/households/:householdId/chores/:choreId', async (c) => {
    const body = await parseBody(c, deleteChoreOpSchema);
    if (!body.ok) return body.response;
    const householdId = c.get('householdId');
    const parentId = c.get('parentId');
    const choreId = c.req.param('choreId');
    if (!z.string().uuid().safeParse(choreId).success) return c.json({ error: 'not_found' }, 404);

    const chore = await db.transaction(async (tx) => {
      const existing = await lockChore(tx, choreId);
      if (!existing || existing.householdId !== householdId) return null;
      const assignees = await assigneesOf(tx, choreId);
      if (existing.deletedAt) return choreToApi(existing, assignees);
      const opAt = new Date(body.data.updated_at);
      const [row] = await tx
        .update(chores)
        .set({ deletedAt: opAt, ...stamp(existing, opAt, parentId) })
        .where(eq(chores.id, choreId))
        .returning();
      return choreToApi(row!, assignees);
    });
    if (!chore) return c.json({ error: 'not_found' }, 404);
    return c.json(chore);
  });

  return app;
}
