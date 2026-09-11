import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/**
 * A literal colour anywhere but the theme module. Three shapes cover everything React Native
 * will accept: a hex value, a functional notation, and a named colour sitting in a `*Color` prop
 * or JSX attribute — each caught as both a string and a template literal, since those are
 * different nodes spelling the same value. The named case is scoped to colour-shaped keys on
 * purpose: `'white'` is only a colour where something is being coloured, and an unscoped word
 * list would fail on innocent strings like `'tan'`.
 *
 * Built out of `no-restricted-syntax` rather than a plugin: the approved dependency list in
 * `docs/spec/04-milestones.md` is the contract, and this rule is not worth widening it for.
 *
 * It reaches `.ts` and `.tsx` only. `app.json` holds a splash and adaptive-icon background that
 * Expo reads at build time and no lint rule can see; those two are kept in step with the ground
 * token by hand.
 */
const COLOUR_MESSAGE =
  'No literal colour outside src/theme. Use a theme token: useThemedStyles((theme) => ...) or useTheme().colors.';

const HEX = '^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$';
const FUNCTIONAL = '^(?:rgb|rgba|hsl|hsla)\\(';

const NO_LITERAL_COLOURS = [
  { selector: `Literal[value=/${HEX}/]`, message: COLOUR_MESSAGE },
  { selector: `Literal[value=/${FUNCTIONAL}/]`, message: COLOUR_MESSAGE },
  // A template literal spells the same value without being a `Literal` node.
  { selector: `TemplateElement[value.raw=/${HEX}/]`, message: COLOUR_MESSAGE },
  { selector: `TemplateElement[value.raw=/${FUNCTIONAL}/]`, message: COLOUR_MESSAGE },
  // A named colour, but only where something is being coloured: `'white'` is a colour in a
  // `*Color` prop and an innocent string anywhere else. Both key spellings, since `{ color: x }`
  // and `{ 'color': x }` are the same object.
  {
    selector: 'Property[key.name=/[Cc]olor$/] > Literal[value=/^[A-Za-z]+$/]',
    message: COLOUR_MESSAGE,
  },
  {
    selector: 'Property[key.value=/[Cc]olor$/] > Literal[value=/^[A-Za-z]+$/]',
    message: COLOUR_MESSAGE,
  },
  {
    selector: 'JSXAttribute[name.name=/[Cc]olor$/] > Literal[value=/^[A-Za-z#]/]',
    message: 'No literal colour outside src/theme. Pass a theme token: useTheme().colors.<token>.',
  },
];

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.expo/**', '**/.turbo/**', '**/drizzle/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    // Metro bundles an asset only from a literal `require`, so image maps cannot be `import`ed.
    files: ['apps/mobile/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-require-imports': ['error', { allow: ['\\.(webp|png)$'] }],
      'no-restricted-syntax': ['error', ...NO_LITERAL_COLOURS],
    },
  },
  {
    // The one place a colour value may be written down.
    files: ['apps/mobile/src/theme/**/*.{ts,tsx}'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
