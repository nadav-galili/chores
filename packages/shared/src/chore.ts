import { z } from 'zod';
import { choreKindSchema } from './materialize.ts';

/** Household-local calendar date, `YYYY-MM-DD`. */
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

/** Every bit of the weekday mask, Mon=0 … Sun=6. */
export const ALL_WEEKDAYS = 0b111_1111;

/** A writer clock, normalized to canonical ISO so clocks compare correctly as strings. */
export const writerClockSchema = z
  .string()
  .datetime()
  .transform((s) => new Date(s).toISOString());

const choreFieldsBase = z.object({
  title: z.string().trim().min(1).max(60),
  icon: z.string().trim().min(1).max(8).nullable().default(null),
  kind: choreKindSchema,
  /** Bit mask, Mon=0 … Sun=6. Required (non-zero) for `weekdays`. */
  weekday_mask: z.number().int().min(0).max(ALL_WEEKDAYS).nullable().default(null),
  start_date: isoDateSchema.nullable().default(null),
  end_date: isoDateSchema.nullable().default(null),
  /** Required for `once`. */
  due_date: isoDateSchema.nullable().default(null),
  requires_photo: z.boolean().default(false),
  /** Children this chore is assigned to; at least one. */
  assignees: z.array(z.string().uuid()).min(1),
});

/** The parent-editable fields of a chore, validated as a whole (kind-specific rules included). */
export const choreFieldsSchema = choreFieldsBase.superRefine((c, ctx) => {
  if (c.kind === 'weekdays' && !c.weekday_mask) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['weekday_mask'],
      message: 'a weekdays chore needs at least one weekday',
    });
  }
  if (c.kind === 'once' && c.due_date === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['due_date'],
      message: 'a once chore needs a due date',
    });
  }
  if (c.start_date !== null && c.end_date !== null && c.end_date < c.start_date) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['end_date'],
      message: 'end date is before start date',
    });
  }
});
export type ChoreFields = z.infer<typeof choreFieldsSchema>;
export type ChoreField = keyof ChoreFields;

export const CHORE_FIELDS = Object.keys(choreFieldsBase.shape) as ChoreField[];

/**
 * `upsert_chore`: the fields this writer changed, stamped with the writer's clock.
 * A create carries every field; an edit carries only what changed.
 */
export const upsertChoreOpSchema = z.object({
  fields: choreFieldsBase.partial(),
  updated_at: writerClockSchema,
});
export type UpsertChoreOp = z.infer<typeof upsertChoreOpSchema>;

/** Per-field writer clocks: when each field was last written, as sent by the writer. */
export type ChoreClocks = Partial<Record<ChoreField, string>>;

export type ChoreState = { fields: ChoreFields; clocks: ChoreClocks };

export type ApplyChoreOpResult =
  (ChoreState & { ok: true; changed: ChoreField[] }) | { ok: false; issues: z.ZodIssue[] };

/**
 * Last-writer-wins per field: a field in the op lands only if the op's clock is not older
 * than that field's last write. The merged row must still be a valid chore.
 */
export function applyChoreOp(current: ChoreState | null, op: UpsertChoreOp): ApplyChoreOpResult {
  const fields: Record<string, unknown> = { ...(current?.fields ?? {}) };
  const clocks: ChoreClocks = { ...(current?.clocks ?? {}) };
  const changed: ChoreField[] = [];
  const clock = new Date(op.updated_at).toISOString();
  for (const key of CHORE_FIELDS) {
    if (!(key in op.fields) || op.fields[key] === undefined) continue;
    const last = clocks[key];
    if (last !== undefined && clock < last) continue;
    fields[key] = op.fields[key];
    clocks[key] = clock;
    changed.push(key);
  }
  const parsed = choreFieldsSchema.safeParse(fields);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues };
  return { ok: true, fields: parsed.data, clocks, changed };
}

/** A chore as the API returns it and as the device stores it. */
export const choreSchema = choreFieldsBase.extend({
  id: z.string().uuid(),
  household_id: z.string().uuid(),
  version: z.number().int().positive(),
  updated_at: z.string().datetime(),
  updated_by: z.string().uuid(),
  deleted_at: z.string().datetime().nullable(),
});
export type Chore = z.infer<typeof choreSchema>;

/** The editable fields of a chore, e.g. as the starting point of an edit. */
export function choreFieldsOf(chore: Chore): ChoreFields {
  return Object.fromEntries(CHORE_FIELDS.map((k) => [k, chore[k]])) as ChoreFields;
}
