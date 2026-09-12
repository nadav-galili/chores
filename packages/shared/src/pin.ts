// The Parent PIN, hashed with a self-contained SHA-256 so the kid device (Hermes) and the server
// (Node) agree without a crypto dependency, the way `uuid5.ts` carries its own SHA-1.

import { z } from 'zod';

/** Four digits, and only digits: the PIN is a door a child faces, not a password (ADR-0013). */
export const pinSchema = z.string().regex(/^[0-9]{4}$/);

export const setPinInputSchema = z.object({ pin: pinSchema });
export type SetPinInput = z.infer<typeof setPinInputSchema>;

/**
 * `SHA-256(salt ‖ pin)`, hex. One round, deliberately: ADR-0013 names the attempt limit, not the
 * cost of the hash, as what stops a curious child.
 */
export function hashPin(salt: string, pin: string): string {
  return sha256Hex(new TextEncoder().encode(salt + pin));
}

/**
 * The whole check, made on the kid device with no network (ADR-0013). A household with no PIN yet
 * — or a device holding a session from before it had one — opens for nothing.
 */
export function verifyPin(
  hash: string | null | undefined,
  salt: string | null | undefined,
  entered: string,
): boolean {
  if (!hash || !salt) return false;
  if (!pinSchema.safeParse(entered).success) return false;
  return hashPin(salt, entered) === hash;
}

/** Five tries, then a minute's wait: the attempt limit is what stops a curious child (ADR-0013). */
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_COOLDOWN_MS = 60_000;

/** The counter the kid device keeps in its secure store, so a restart does not clear it. */
export const pinAttemptsSchema = z.object({
  wrong: z.number().int().min(0),
  cooldown_until: z.number().nullable(),
});
export type PinAttempts = z.infer<typeof pinAttemptsSchema>;
export const NO_PIN_ATTEMPTS: PinAttempts = { wrong: 0, cooldown_until: null };

/** How long the door stays shut; zero means it is open. */
export function pinCooldownMsLeft(attempts: PinAttempts, now: number): number {
  return Math.max(0, (attempts.cooldown_until ?? 0) - now);
}

/** A wrong try. The fifth starts the cooldown, and the count begins again behind it. */
export function afterWrongPin(attempts: PinAttempts, now: number): PinAttempts {
  const wrong = attempts.wrong + 1;
  if (wrong >= PIN_MAX_ATTEMPTS) return { wrong: 0, cooldown_until: now + PIN_COOLDOWN_MS };
  // A cooldown already served is dropped rather than carried, so a later try reads it as open.
  return {
    wrong,
    cooldown_until: pinCooldownMsLeft(attempts, now) > 0 ? attempts.cooldown_until : null,
  };
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

function sha256Hex(message: Uint8Array): string {
  const bitLength = message.length * 8;
  const paddedLength = Math.ceil((message.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!;
      const b = w[i - 2]!;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }

    let a = h[0]!;
    let b = h[1]!;
    let c = h[2]!;
    let d = h[3]!;
    let e = h[4]!;
    let f = h[5]!;
    let g = h[6]!;
    let hh = h[7]!;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + K[i]! + w[i]!) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    for (const [i, x] of [a, b, c, d, e, f, g, hh].entries()) h[i] = (h[i]! + x) >>> 0;
  }

  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('');
}
