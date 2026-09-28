import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { instanceId, uuid7 } from '@chores/shared';
import { openTestDb, openTestDbAt } from '@/db/test-db';
import type { DeviceDb } from '@/db/types';
import { choreAssignees, chores, completions, notificationState, outbox } from '@/db/schema';
import { applyPull, materializeToday } from './engine';
import { tapContext, tapToggle, type ChildContext } from './local';
import {
  declinePush,
  forgetRegisteredToken,
  mayAskForPush,
  registerPushToken,
  scheduleReminder,
  serverHoldsToken,
} from './notifications';
import { dropOp } from './outbox';

let db: DeviceDb;
const now = new Date('2026-09-09T10:00:00.000Z');

beforeEach(async () => {
  db = await openTestDb();
});

const ops = () => db.select().from(outbox);
const state = async () => (await db.select().from(notificationState))[0];

describe('registerPushToken', () => {
  it('queues one op and records the token the server now knows', async () => {
    expect(await registerPushToken(db, { token: 'ExponentPushToken[a]', locale: 'en' }, now)).toBe(
      true,
    );

    const queued = await ops();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      type: 'register_push_token',
      payload: { expo_push_token: 'ExponentPushToken[a]', locale: 'en' },
      status: 'pending',
    });
    expect((await state())?.push_token).toBe('ExponentPushToken[a]');
  });

  it('says nothing twice about a token the server already has', async () => {
    await registerPushToken(db, { token: 'ExponentPushToken[a]', locale: 'en' }, now);
    expect(await registerPushToken(db, { token: 'ExponentPushToken[a]', locale: 'en' }, now)).toBe(
      false,
    );
    expect(await ops()).toHaveLength(1);
  });

  it('registers a rotated token', async () => {
    await registerPushToken(db, { token: 'ExponentPushToken[a]', locale: 'en' }, now);
    expect(await registerPushToken(db, { token: 'ExponentPushToken[b]', locale: 'en' }, now)).toBe(
      true,
    );
    expect(await ops()).toHaveLength(2);
    expect((await state())?.push_token).toBe('ExponentPushToken[b]');
  });

  it('registers again when the phone changes language, so the push follows it', async () => {
    await registerPushToken(db, { token: 'ExponentPushToken[a]', locale: 'en' }, now);
    expect(await registerPushToken(db, { token: 'ExponentPushToken[a]', locale: 'he' }, now)).toBe(
      true,
    );
    const queued = await ops();
    expect(queued).toHaveLength(2);
    expect(queued[1]).toMatchObject({
      payload: { expo_push_token: 'ExponentPushToken[a]', locale: 'he' },
    });
    expect((await state())?.locale).toBe('he');
  });

  it('leaves the reminder it has already scheduled alone', async () => {
    await scheduleReminder(db, '16:00', () => Promise.resolve(), now);
    await registerPushToken(db, { token: 'ExponentPushToken[a]', locale: 'en' }, now);
    expect(await state()).toMatchObject({
      reminder_time: '16:00',
      push_token: 'ExponentPushToken[a]',
    });
  });
});

describe('serverHoldsToken', () => {
  it('is false until the op carrying the token has been acked', async () => {
    expect(await serverHoldsToken(db)).toBe(false);

    await registerPushToken(db, { token: 'ExponentPushToken[a]', locale: 'en' }, now);
    // Queued, not acked: the cron has nothing to push to yet.
    expect(await serverHoldsToken(db)).toBe(false);

    const [queued] = await ops();
    await dropOp(db, queued!.op_id);
    expect(await serverHoldsToken(db)).toBe(true);
  });

  it('is false again once a refused token is forgotten', async () => {
    await registerPushToken(db, { token: 'ExponentPushToken[a]', locale: 'en' }, now);
    const [queued] = await ops();
    await dropOp(db, queued!.op_id);
    await forgetRegisteredToken(db, now);
    expect(await serverHoldsToken(db)).toBe(false);
  });
});

describe('forgetRegisteredToken', () => {
  it('lets the same token be registered again after the server refused it', async () => {
    await registerPushToken(db, { token: 'ExponentPushToken[a]', locale: 'en' }, now);
    await forgetRegisteredToken(db, now);
    expect((await state())?.push_token).toBeNull();
    expect(await registerPushToken(db, { token: 'ExponentPushToken[a]', locale: 'en' }, now)).toBe(
      true,
    );
  });
});

describe('scheduleReminder', () => {
  /** Stands in for the OS: records what the device asked to be woken at. */
  function scheduler() {
    const asked: (string | null)[] = [];
    return { asked, schedule: (time: string | null) => (asked.push(time), Promise.resolve()) };
  }

  it('schedules a reminder time this device has not scheduled yet', async () => {
    const os = scheduler();
    expect(await scheduleReminder(db, '16:00', os.schedule, now)).toBe(true);
    expect(os.asked).toEqual(['16:00']);
    expect((await state())?.reminder_time).toBe('16:00');
  });

  it('does not reschedule a reminder that has not moved', async () => {
    const os = scheduler();
    await scheduleReminder(db, '16:00', os.schedule, now);
    expect(await scheduleReminder(db, '16:00', os.schedule, now)).toBe(false);
    expect(os.asked).toEqual(['16:00']);
  });

  it('reschedules when the parent moves the time, and cancels when they clear it', async () => {
    const os = scheduler();
    await scheduleReminder(db, '16:00', os.schedule, now);
    await scheduleReminder(db, '17:30', os.schedule, now);
    await scheduleReminder(db, null, os.schedule, now);
    expect(os.asked).toEqual(['16:00', '17:30', null]);
    expect((await state())?.reminder_time).toBeNull();
  });

  it('does nothing for a child who has never had a reminder', async () => {
    const os = scheduler();
    expect(await scheduleReminder(db, null, os.schedule, now)).toBe(false);
    expect(os.asked).toEqual([]);
  });

  it('keeps the reminder unscheduled when the OS refuses', async () => {
    const failing = () => Promise.reject(new Error('no permission'));
    await expect(scheduleReminder(db, '16:00', failing, now)).rejects.toThrow('no permission');
    expect(await state()).toBeUndefined();
  });
});

describe('mayAskForPush', () => {
  const childId = uuid7();
  const householdId = uuid7();
  const TODAY = '2026-09-09';
  const child: ChildContext = {
    householdId,
    childId,
    deviceId: uuid7(),
    tz: 'Asia/Jerusalem',
    dayBoundaryHour: 0,
  };

  /** A daily chore for this child with today's Instance materialized, as a first open has it. */
  async function seedChore() {
    const id = uuid7();
    await db.insert(chores).values({
      id,
      household_id: householdId,
      title: 'Dishes',
      icon: '🍽️',
      kind: 'daily',
      weekday_mask: null,
      start_date: null,
      end_date: null,
      due_date: null,
      requires_photo: false,
      version: 1,
      updated_at: now.toISOString(),
      updated_by: uuid7(),
      deleted_at: null,
      field_clocks: {},
    });
    await db.insert(choreAssignees).values({ chore_id: id, child_id: childId });
    await materializeToday(db, childId, TODAY);
    return { chore_id: id, id: instanceId(id, childId, TODAY) };
  }

  const tap = (instance: { chore_id: string; id: string }, status: 'due' | 'done') =>
    tapToggle(db, tapContext(child, now), { ...instance, status });

  it('never asks a child with no reminder time, whatever they have done', async () => {
    expect(await mayAskForPush(db, childId, null)).toBe(false);
    await tap(await seedChore(), 'due');
    expect(await mayAskForPush(db, childId, null)).toBe(false);
  });

  it('does not ask on a first open, before the device has any completion', async () => {
    await seedChore();
    expect(await mayAskForPush(db, childId, '16:00')).toBe(false);
  });

  it('asks once the device has a completion and there is a reminder to deliver', async () => {
    await tap(await seedChore(), 'due');
    expect(await mayAskForPush(db, childId, '16:00')).toBe(true);
  });

  it('does not count a tap the child took back', async () => {
    const instance = await seedChore();
    await tap(instance, 'due');
    await tap(instance, 'done');
    expect(await mayAskForPush(db, childId, '16:00')).toBe(false);
  });

  it('counts a completion the device learned from a sync, as a rejoined device has', async () => {
    const instance = await seedChore();
    const id = uuid7();
    await applyPull(db, {
      acked: [],
      rejected: [],
      has_more: false,
      cursor: 1,
      changes: [
        {
          seq: 1,
          table: 'completions',
          row_id: id,
          op: 'insert',
          row: {
            id,
            instance_id: instance.id,
            chore_id: instance.chore_id,
            child_id: childId,
            household_id: householdId,
            chore_date: TODAY,
            completed_at: now.toISOString(),
            device_id: null,
            photo_key: null,
            status: 'accepted',
            rejected_by: null,
            rejected_at: null,
            created_at: now.toISOString(),
          },
        },
      ],
    });
    expect(await db.select().from(completions)).toHaveLength(1);
    expect(await mayAskForPush(db, childId, '16:00')).toBe(true);
  });

  it('never asks again once the child said "Not now", however much they do after', async () => {
    await tap(await seedChore(), 'due');
    await declinePush(db, now);
    expect(await mayAskForPush(db, childId, '16:00')).toBe(false);
    await tap(await seedChore(), 'due');
    expect(await mayAskForPush(db, childId, '17:30')).toBe(false);
  });

  it('remembers "Not now" across a restart, so the next launch does not explain again', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mibo-'));
    try {
      const file = path.join(dir, 'mibo.db');
      const first = await openTestDbAt(file);
      await declinePush(first.db, now);
      first.close();

      const second = await openTestDbAt(file);
      db = second.db;
      await tap(await seedChore(), 'due');
      expect(await mayAskForPush(db, childId, '16:00')).toBe(false);
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not disturb what the reminder arrangement has recorded', async () => {
    await registerPushToken(db, { token: 'ExponentPushToken[a]', locale: 'en' }, now);
    await declinePush(db, now);
    expect((await state())?.push_token).toBe('ExponentPushToken[a]');
  });
});
