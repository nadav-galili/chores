import { beforeEach, describe, expect, it } from 'vitest';
import { openTestDb } from '@/db/test-db';
import type { DeviceDb } from '@/db/types';
import { notificationState, outbox } from '@/db/schema';
import {
  forgetRegisteredToken,
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
    expect(await registerPushToken(db, 'ExponentPushToken[a]', now)).toBe(true);

    const queued = await ops();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      type: 'register_push_token',
      payload: { expo_push_token: 'ExponentPushToken[a]' },
      status: 'pending',
    });
    expect((await state())?.push_token).toBe('ExponentPushToken[a]');
  });

  it('says nothing twice about a token the server already has', async () => {
    await registerPushToken(db, 'ExponentPushToken[a]', now);
    expect(await registerPushToken(db, 'ExponentPushToken[a]', now)).toBe(false);
    expect(await ops()).toHaveLength(1);
  });

  it('registers a rotated token', async () => {
    await registerPushToken(db, 'ExponentPushToken[a]', now);
    expect(await registerPushToken(db, 'ExponentPushToken[b]', now)).toBe(true);
    expect(await ops()).toHaveLength(2);
    expect((await state())?.push_token).toBe('ExponentPushToken[b]');
  });

  it('leaves the reminder it has already scheduled alone', async () => {
    await scheduleReminder(db, '16:00', () => Promise.resolve(), now);
    await registerPushToken(db, 'ExponentPushToken[a]', now);
    expect(await state()).toMatchObject({
      reminder_time: '16:00',
      push_token: 'ExponentPushToken[a]',
    });
  });
});

describe('serverHoldsToken', () => {
  it('is false until the op carrying the token has been acked', async () => {
    expect(await serverHoldsToken(db)).toBe(false);

    await registerPushToken(db, 'ExponentPushToken[a]', now);
    // Queued, not acked: the cron has nothing to push to yet.
    expect(await serverHoldsToken(db)).toBe(false);

    const [queued] = await ops();
    await dropOp(db, queued!.op_id);
    expect(await serverHoldsToken(db)).toBe(true);
  });

  it('is false again once a refused token is forgotten', async () => {
    await registerPushToken(db, 'ExponentPushToken[a]', now);
    const [queued] = await ops();
    await dropOp(db, queued!.op_id);
    await forgetRegisteredToken(db, now);
    expect(await serverHoldsToken(db)).toBe(false);
  });
});

describe('forgetRegisteredToken', () => {
  it('lets the same token be registered again after the server refused it', async () => {
    await registerPushToken(db, 'ExponentPushToken[a]', now);
    await forgetRegisteredToken(db, now);
    expect((await state())?.push_token).toBeNull();
    expect(await registerPushToken(db, 'ExponentPushToken[a]', now)).toBe(true);
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
