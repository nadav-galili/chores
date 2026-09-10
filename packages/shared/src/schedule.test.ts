import { describe, expect, it } from 'vitest';
import {
  localMinutes,
  localTimeFor,
  minutesSinceLocalTime,
  parseLocalTime,
  remindersDue,
  rolloversDue,
  TICK_WINDOW_MINUTES,
  type ReminderChild,
  type RollingHousehold,
} from './schedule.ts';

const JERUSALEM = 'Asia/Jerusalem';
const NEW_YORK = 'America/New_York';

const household = (id: string, tz: string, day_boundary_hour: number): RollingHousehold => ({
  id,
  tz,
  day_boundary_hour,
});

describe('parseLocalTime', () => {
  it('reads a wall clock', () => {
    expect(parseLocalTime('07:05')).toEqual({ hour: 7, minute: 5 });
    expect(parseLocalTime('00:00')).toEqual({ hour: 0, minute: 0 });
  });

  it('refuses anything that is not HH:MM', () => {
    expect(() => parseLocalTime('7:5')).toThrow();
    expect(() => parseLocalTime('24:00')).toThrow();
  });
});

describe('localMinutes', () => {
  it('is the wall clock in the zone, not UTC', () => {
    // 21:30 UTC is 00:30 the next day in Jerusalem (UTC+3 in September).
    expect(localMinutes(new Date('2026-09-09T21:30:00Z'), JERUSALEM)).toBe(30);
    expect(localMinutes(new Date('2026-09-09T21:30:00Z'), NEW_YORK)).toBe(17 * 60 + 30);
  });
});

describe('minutesSinceLocalTime', () => {
  it('counts forward from the last time that wall clock passed', () => {
    const at = new Date('2026-09-09T13:02:00Z'); // 16:02 in Jerusalem
    expect(minutesSinceLocalTime(at, JERUSALEM, '16:00')).toBe(2);
    expect(minutesSinceLocalTime(at, JERUSALEM, '16:02')).toBe(0);
    // Yesterday's 16:05 was 23 h 57 min ago.
    expect(minutesSinceLocalTime(at, JERUSALEM, '16:05')).toBe(23 * 60 + 57);
  });
});

describe('rolloversDue', () => {
  const households = [household('h1', JERUSALEM, 0), household('h2', NEW_YORK, 3)];

  it('rolls a household on the tick its boundary passes, with its new chore date', () => {
    // 21:00 UTC = midnight in Jerusalem on the 10th; New York is still on the 9th at 17:00.
    const due = rolloversDue(households, new Date('2026-09-09T21:00:30Z'));
    expect(due).toEqual([{ household_id: 'h1', chore_date: '2026-09-10' }]);
  });

  it('rolls a boundary hour of 3 three hours after local midnight', () => {
    // 07:00 UTC = 03:00 in New York (UTC-4 in September).
    const due = rolloversDue(households, new Date('2026-09-10T07:00:10Z'));
    expect(due).toEqual([{ household_id: 'h2', chore_date: '2026-09-10' }]);
  });

  it('keeps firing through the catch-up window and stops after it', () => {
    const inWindow = new Date(
      Date.parse('2026-09-09T21:00:00Z') + (TICK_WINDOW_MINUTES - 1) * 60_000,
    );
    const after = new Date(Date.parse('2026-09-09T21:00:00Z') + TICK_WINDOW_MINUTES * 60_000);
    expect(rolloversDue(households, inWindow).map((r) => r.household_id)).toEqual(['h1']);
    expect(rolloversDue(households, after)).toEqual([]);
  });

  it('crosses the boundary exactly once across a DST spring-forward', () => {
    // Jerusalem moves 02:00 → 03:00 on 2027-03-26; a household with boundary 2 still rolls.
    const h = [household('h3', JERUSALEM, 2)];
    const ticks: string[] = [];
    for (
      let t = Date.parse('2027-03-25T20:00:00Z');
      t < Date.parse('2027-03-27T04:00:00Z');
      t += 60_000
    ) {
      for (const due of rolloversDue(h, new Date(t), 1)) ticks.push(due.chore_date);
    }
    expect(ticks).toEqual(['2027-03-26', '2027-03-27']);
  });
});

describe('remindersDue', () => {
  const child = (id: string, reminder_time: string | null, tz = JERUSALEM): ReminderChild => ({
    id,
    tz,
    day_boundary_hour: 0,
    reminder_time,
  });

  it('is the children whose reminder time just passed, with the chore date it belongs to', () => {
    // 13:00 UTC = 16:00 in Jerusalem.
    const due = remindersDue(
      [child('c1', '16:00'), child('c2', '18:00')],
      new Date('2026-09-09T13:00:00Z'),
    );
    expect(due).toEqual([{ child_id: 'c1', chore_date: '2026-09-09', reminder_time: '16:00' }]);
  });

  it('skips a child with no reminder time', () => {
    expect(remindersDue([child('c1', null)], new Date('2026-09-09T13:00:00Z'))).toEqual([]);
  });

  it('fires once per child per day over a day of ticks', () => {
    const children = [child('c1', '16:00')];
    const fired: string[] = [];
    for (
      let t = Date.parse('2026-09-09T00:00:00Z');
      t < Date.parse('2026-09-10T00:00:00Z');
      t += 60_000
    ) {
      for (const due of remindersDue(children, new Date(t), 1)) fired.push(due.chore_date);
    }
    expect(fired).toEqual(['2026-09-09']);
  });
});

describe('localTimeFor', () => {
  const at = new Date('2026-09-09T12:00:00Z');

  it('is the same wall clock when the device is in the household’s zone', () => {
    expect(localTimeFor('16:00', JERUSALEM, at, JERUSALEM)).toEqual({ hour: 16, minute: 0 });
  });

  it('moves the wall clock when the child is somewhere else', () => {
    // 16:00 in Jerusalem (UTC+3) is 09:00 in New York (UTC-4) in September.
    expect(localTimeFor('16:00', JERUSALEM, at, NEW_YORK)).toEqual({ hour: 9, minute: 0 });
    expect(localTimeFor('09:00', NEW_YORK, at, JERUSALEM)).toEqual({ hour: 16, minute: 0 });
  });

  it('wraps around midnight rather than going negative', () => {
    // 02:30 in Jerusalem is 19:30 the previous evening in New York.
    expect(localTimeFor('02:30', JERUSALEM, at, NEW_YORK)).toEqual({ hour: 19, minute: 30 });
    expect(localTimeFor('23:15', NEW_YORK, at, JERUSALEM)).toEqual({ hour: 6, minute: 15 });
  });

  it('follows each zone’s own DST', () => {
    // In January Jerusalem is UTC+2 and New York UTC-5: seven hours, not the September seven.
    const winter = new Date('2027-01-15T12:00:00Z');
    expect(localTimeFor('16:00', JERUSALEM, winter, NEW_YORK)).toEqual({ hour: 9, minute: 0 });
    // Mid-March, New York has sprung forward and Jerusalem has not: six hours.
    const gap = new Date('2027-03-15T12:00:00Z');
    expect(localTimeFor('16:00', JERUSALEM, gap, NEW_YORK)).toEqual({ hour: 10, minute: 0 });
  });
});
