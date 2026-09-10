import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openTestDb, openTestDbAt } from '@/db/test-db';
import type { DeviceDb } from '@/db/types';
import { markDayComplete, markGroveStage, markOpen } from './analytics';
import { cacheFetchedFlags, readFlag } from './flags';

let db: DeviceDb;
let dir: string | undefined;

beforeEach(async () => {
  db = await openTestDb();
});

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('markOpen', () => {
  it('is true the first time this chore date is opened and false after', async () => {
    expect(await markOpen(db, '2026-09-10')).toBe(true);
    expect(await markOpen(db, '2026-09-10')).toBe(false);
    expect(await markOpen(db, '2026-09-10')).toBe(false);
  });

  it('is true again on the next chore date, which is what daily retention counts', async () => {
    await markOpen(db, '2026-09-10');
    expect(await markOpen(db, '2026-09-11')).toBe(true);
  });

  it('does not report an open again when the day boundary moves the date backwards', async () => {
    await markOpen(db, '2026-09-11');
    expect(await markOpen(db, '2026-09-10')).toBe(false);
  });
});

describe('markDayComplete', () => {
  it('is true once per chore date, however often the day is read as complete', async () => {
    expect(await markDayComplete(db, '2026-09-10')).toBe(true);
    expect(await markDayComplete(db, '2026-09-10')).toBe(false);
    expect(await markDayComplete(db, '2026-09-11')).toBe(true);
  });

  it('is independent of the open on the same day', async () => {
    await markOpen(db, '2026-09-10');
    expect(await markDayComplete(db, '2026-09-10')).toBe(true);
    expect(await markOpen(db, '2026-09-10')).toBe(false);
  });
});

describe('markGroveStage', () => {
  it('records the grove a device starts with, and reports only what grows after', async () => {
    expect(await markGroveStage(db, 0)).toBe(false);
    expect(await markGroveStage(db, 1)).toBe(true);
    expect(await markGroveStage(db, 1)).toBe(false);
    expect(await markGroveStage(db, 2)).toBe(true);
  });

  it('says nothing about a grove a rejoined device is only just learning about', async () => {
    expect(await markGroveStage(db, 7)).toBe(false);
    expect(await markGroveStage(db, 7)).toBe(false);
    expect(await markGroveStage(db, 8)).toBe(true);
  });

  it('never reports a shrink: a tree is never taken back (ADR-0011)', async () => {
    await markGroveStage(db, 0);
    await markGroveStage(db, 3);
    expect(await markGroveStage(db, 2)).toBe(false);
    expect(await markGroveStage(db, 3)).toBe(false);
    expect(await markGroveStage(db, 4)).toBe(true);
  });
});

describe('what is remembered', () => {
  it('survives a restart, so a relaunch on the same day is not another open', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'mibo-'));
    const file = path.join(dir, 'mibo.db');
    const first = await openTestDbAt(file);
    expect(await markOpen(first.db, '2026-09-10')).toBe(true);
    first.close();

    const second = await openTestDbAt(file);
    expect(await markOpen(second.db, '2026-09-10')).toBe(false);
    second.close();
  });
});

describe('cacheFetchedFlags', () => {
  const now = new Date('2026-09-10T08:00:00.000Z');

  it('caches what parent mode fetched, so kid mode can read it offline', async () => {
    expect(await cacheFetchedFlags(db, { pet_enabled: false, grove_enabled: true }, now)).toEqual([
      'pet_enabled',
      'grove_enabled',
    ]);
    expect(await readFlag(db, 'pet_enabled')).toBe(false);
    expect(await readFlag(db, 'grove_enabled')).toBe(true);
  });

  it('caches the two flags independently, so either bet can be turned off alone', async () => {
    await cacheFetchedFlags(db, { pet_enabled: false, grove_enabled: true }, now);
    await cacheFetchedFlags(db, { pet_enabled: true, grove_enabled: false }, now);
    expect(await readFlag(db, 'pet_enabled')).toBe(true);
    expect(await readFlag(db, 'grove_enabled')).toBe(false);
  });

  it('reads a variant as the experience being on; only an explicit false turns it off', async () => {
    await cacheFetchedFlags(db, { pet_enabled: 'sparkly', grove_enabled: false }, now);
    expect(await readFlag(db, 'pet_enabled')).toBe(true);
    expect(await readFlag(db, 'grove_enabled')).toBe(false);
  });

  it('leaves a flag the project does not define at what the cache last knew', async () => {
    await cacheFetchedFlags(db, { pet_enabled: false }, now);
    expect(await cacheFetchedFlags(db, { grove_enabled: true }, now)).toEqual(['grove_enabled']);
    expect(await readFlag(db, 'pet_enabled')).toBe(false);
  });

  it('caches nothing it was not given, so an empty answer changes nothing', async () => {
    await cacheFetchedFlags(db, { pet_enabled: false }, now);
    expect(await cacheFetchedFlags(db, {}, now)).toEqual([]);
    expect(await readFlag(db, 'pet_enabled')).toBe(false);
  });
});
