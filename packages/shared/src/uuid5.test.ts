import { describe, expect, it } from 'vitest';
import { uuid5, uuidV5, NAMESPACE_DNS } from './uuid5.ts';

describe('uuidV5', () => {
  it('matches the RFC 4122 reference vector for python.org in the DNS namespace', () => {
    expect(uuidV5(NAMESPACE_DNS, 'python.org')).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d');
  });

  it('pads correctly when the padding spills into a second SHA-1 block (56 bytes)', () => {
    // uuid.uuid5(uuid.NAMESPACE_DNS, 'a' * 40) in CPython
    expect(uuidV5(NAMESPACE_DNS, 'a'.repeat(40))).toBe('39f39c20-db47-5131-8879-62f8f67f9014');
  });

  it('hashes names longer than one SHA-1 block', () => {
    // uuid.uuid5(uuid.NAMESPACE_DNS, 'a' * 100) in CPython
    expect(uuidV5(NAMESPACE_DNS, 'a'.repeat(100))).toBe('56596f37-716c-57a9-a735-2561f8608390');
  });

  it('hashes multi-byte names as UTF-8', () => {
    // uuid.uuid5(uuid.NAMESPACE_DNS, 'שלום') in CPython
    expect(uuidV5(NAMESPACE_DNS, 'שלום')).toBe('de2fa681-37e6-55a2-849e-25df8bf89e10');
  });
});

describe('uuid5 (app namespace)', () => {
  it('is deterministic and versioned', () => {
    const a = uuid5('chore-1', 'child-1', '2026-09-09');
    expect(a).toBe(uuid5('chore-1', 'child-1', '2026-09-09'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('separates parts so that shifting a boundary changes the id', () => {
    expect(uuid5('ab', 'c')).not.toBe(uuid5('a', 'bc'));
  });
});
