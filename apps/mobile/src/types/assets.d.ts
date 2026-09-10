// Metro resolves a font file to an opaque module id; nothing reads the value
// but `expo-font`, which takes it as a source. Expo's own types don't cover
// `.ttf`, and `expo-env.d.ts` is generated and gitignored, so it lives here.
declare module '*.ttf' {
  const asset: number;
  export default asset;
}
