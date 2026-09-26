/**
 * Checks the five identity assets `app.json` points at — the icon, the three adaptive-icon layers
 * and the splash mark — plus the web favicon.
 *
 * Every path here is read *out of* `app.json` rather than hard-coded, so a renamed file that the
 * config was never updated for fails as a missing asset rather than passing quietly. The rules are
 * `docs/design/prompts.md`: 1024x1024 for the identity set, the iOS icon with no alpha at all
 * (the App Store rejects a transparent icon outright), the masked layers with alpha, and the two
 * layers Android runs a launcher mask over clear of the 61% circle.
 *
 * That last one is the check `docs/design/prompts.md` records failing twice by eye: a foreground
 * that sits entirely inside the 60% box it was drawn to can still put hundreds of painted pixels
 * outside the circle the box's corners poke out of. So it is counted, not looked at.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');

/** Android's guaranteed-visible zone: a centred circle of 61% of the canvas. */
const SAFE_CIRCLE = 0.61;

type Png = {
  width: number;
  height: number;
  hasAlpha: boolean;
  alphaAt: (x: number, y: number) => number;
};

function decode(file: string): Png {
  const data = readFileSync(file);
  if (data.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file}: not a PNG`);

  let width = 0;
  let height = 0;
  let depth = 0;
  let colourType = 0;
  let palette: Buffer | undefined;
  let transparency: Buffer | undefined;
  const idat: Buffer[] = [];

  for (let i = 8; i < data.length;) {
    const length = data.readUInt32BE(i);
    const type = data.toString('latin1', i + 4, i + 8);
    const body = data.subarray(i + 8, i + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body.readUInt8(8);
      colourType = body.readUInt8(9);
      if (body.readUInt8(12) !== 0) throw new Error(`${file}: interlaced PNGs are not supported`);
    } else if (type === 'PLTE') palette = Buffer.from(body);
    else if (type === 'tRNS') transparency = Buffer.from(body);
    else if (type === 'IDAT') idat.push(Buffer.from(body));
    i += 12 + length;
  }

  // Colour type 3 is a palette (alpha lives in tRNS), 4 is grey+alpha, 6 is RGBA; 0 and 2 have no
  // alpha channel at all. Everything the app ships is a palette PNG; the rest are here so that
  // swapping one asset for a straight RGBA export is a check that still runs, not a crash.
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colourType];
  if (channels === undefined) throw new Error(`${file}: unknown colour type ${colourType}`);
  if (colourType !== 3 && depth !== 8 && depth !== 16) {
    throw new Error(`${file}: bit depth ${depth} is only supported on a palette`);
  }
  if (colourType === 3 && palette === undefined)
    throw new Error(`${file}: palette PNG with no PLTE`);
  // On colour types 0 and 2, tRNS is a colour key rather than a table, and this decoder does not
  // read one. Refusing the file is the only honest answer: reporting it opaque would let a
  // transparent icon through the App Store rule below.
  if ((colourType === 0 || colourType === 2) && transparency !== undefined) {
    throw new Error(`${file}: colour-key transparency (tRNS on colour type ${colourType})`);
  }

  const hasAlpha =
    colourType === 4 || colourType === 6 || (colourType === 3 && transparency !== undefined);

  const bitsPerPixel = channels * depth;
  const bytesPerPixel = Math.max(1, bitsPerPixel >> 3);
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const filtered = inflateSync(Buffer.concat(idat));
  const scanlines = Buffer.alloc(stride * height);

  // A truncated stream is the one corruption that would fail *quietly*: the missing rows read back
  // as zero, which is transparent, which is a safe-zone count of 0 on an asset that overflows it.
  if (filtered.length !== (stride + 1) * height) {
    throw new Error(
      `${file}: ${filtered.length} byte(s) of image data, expected ${(stride + 1) * height}`,
    );
  }

  // Out of range is a corrupt file, not a case to handle: the length check above rules it out, and
  // the PNG spec itself defines the off-canvas neighbours a row filter reaches for as zero.
  const at = (buffer: Uint8Array, index: number) => buffer[index] ?? 0;

  for (let y = 0; y < height; y++) {
    const filter = at(filtered, y * (stride + 1));
    const line = filtered.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = y * stride;
    const up = out - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bytesPerPixel ? at(scanlines, out + x - bytesPerPixel) : 0;
      const b = y > 0 ? at(scanlines, up + x) : 0;
      const c = x >= bytesPerPixel && y > 0 ? at(scanlines, up + x - bytesPerPixel) : 0;
      let value = at(line, x);
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`${file}: unknown row filter ${filter}`);
      scanlines[out + x] = value & 0xff;
    }
  }

  const sample = (x: number, y: number, channel: number) => {
    if (depth === 8) return at(scanlines, y * stride + x * channels + channel);
    // 16-bit samples are big-endian; only the high byte matters to any check here.
    if (depth === 16) return at(scanlines, y * stride + (x * channels + channel) * 2);
    const bit = (x * channels + channel) * depth;
    const byte = at(scanlines, y * stride + (bit >> 3));
    return (byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
  };

  const alphaAt = (x: number, y: number) => {
    if (!hasAlpha) return 255;
    // A palette PNG's tRNS is shorter than its PLTE whenever the trailing entries are opaque, and
    // the entries it leaves off are opaque rather than absent — defaulting them to 0 would erase
    // painted pixels from the mask count and turn a real overflow into a pass.
    if (transparency !== undefined && colourType === 3) return transparency[sample(x, y, 0)] ?? 255;
    return sample(x, y, channels - 1);
  };

  return { width, height, hasAlpha, alphaAt };
}

/** Painted pixels falling outside the centred circle a launcher mask keeps. */
function outsideSafeCircle(png: Png): number {
  const radius = (png.width * SAFE_CIRCLE) / 2;
  const centre = png.width / 2;
  let count = 0;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if (png.alphaAt(x, y) === 0) continue;
      const dx = x + 0.5 - centre;
      const dy = y + 0.5 - centre;
      if (dx * dx + dy * dy > radius * radius) count++;
    }
  }
  return count;
}

type Rule = { size: number; alpha: boolean; masked?: boolean };

const config = JSON.parse(readFileSync(path.join(root, 'app.json'), 'utf8')) as {
  expo: {
    icon: string;
    web?: { favicon?: string };
    android: { adaptiveIcon: Record<string, string> };
    plugins: (string | [string, Record<string, unknown>])[];
  };
};
const { expo } = config;
const splash = expo.plugins.find(
  (p): p is [string, { image: string }] => Array.isArray(p) && p[0] === 'expo-splash-screen',
);
if (!splash) throw new Error('app.json: no expo-splash-screen plugin entry');

const assets: [label: string, asset: string | undefined, rule: Rule][] = [
  // The App Store rejects an icon with an alpha channel, so this one is opaque on purpose.
  ['expo.icon', expo.icon, { size: 1024, alpha: false }],
  [
    'expo.android.adaptiveIcon.foregroundImage',
    expo.android.adaptiveIcon.foregroundImage,
    { size: 1024, alpha: true, masked: true },
  ],
  [
    'expo.android.adaptiveIcon.backgroundImage',
    expo.android.adaptiveIcon.backgroundImage,
    { size: 1024, alpha: false },
  ],
  [
    'expo.android.adaptiveIcon.monochromeImage',
    expo.android.adaptiveIcon.monochromeImage,
    { size: 1024, alpha: true, masked: true },
  ],
  ['expo-splash-screen.image', splash[1].image, { size: 1024, alpha: true }],
  ['expo.web.favicon', expo.web?.favicon, { size: 48, alpha: false }],
];

const failures: string[] = [];
for (const [label, asset, rule] of assets) {
  if (!asset) {
    failures.push(`${label}: not set in app.json`);
    continue;
  }
  const file = path.join(root, asset);
  let png: Png;
  try {
    png = decode(file);
  } catch (error) {
    failures.push(`${label} -> ${asset}: ${(error as Error).message}`);
    continue;
  }
  const notes: string[] = [];
  const rightSize = png.width === rule.size && png.height === rule.size;
  if (!rightSize) {
    notes.push(`is ${png.width}x${png.height}, expected ${rule.size}x${rule.size}`);
  }
  if (png.hasAlpha !== rule.alpha) {
    notes.push(rule.alpha ? 'has no transparency' : 'has transparency');
  }
  // The safe circle is centred on a square canvas, so a wrong-sized asset would be counted against
  // the wrong circle. The size note is the finding there; a second number derived from it is noise.
  if (rule.masked && rightSize) {
    const outside = outsideSafeCircle(png);
    if (outside > 0)
      notes.push(`${outside} painted pixel(s) outside the ${SAFE_CIRCLE * 100}% circle`);
  }
  if (notes.length > 0) failures.push(`${label} -> ${asset}: ${notes.join('; ')}`);
  else console.log(`ok  ${label} -> ${asset}`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}
console.log(`${assets.length} asset(s) ok`);
