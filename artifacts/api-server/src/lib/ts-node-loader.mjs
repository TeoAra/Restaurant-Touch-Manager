/**
 * Minimal ESM loader: rewrites .js imports to .ts so that
 * `node --experimental-strip-types --loader ./ts-node-loader.mjs`
 * can resolve TypeScript source files when running tests directly.
 *
 * This file is intentionally plain .mjs (no TypeScript) so it can be
 * used as a --loader without itself needing type stripping.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".js")) {
    const tsSpecifier = specifier.slice(0, -3) + ".ts";
    try {
      return await nextResolve(tsSpecifier, context);
    } catch {
      // fall through to original specifier
    }
  }
  return nextResolve(specifier, context);
}
