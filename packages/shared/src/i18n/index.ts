import { en } from './en.ts';
import { he } from './he.ts';
import type { Locale } from '../locale.ts';

export type { Catalog } from './en.ts';
export * from './format.ts';

/** Every string the app says, one catalog per locale. The wiring lives on the device. */
export const CATALOGS: Readonly<Record<Locale, typeof en>> = { en, he };
