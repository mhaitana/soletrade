// Stub for the `server-only` package when running repo scripts via tsx.
//
// `server-only` is a Next-bundler guard: its package.json exports an empty module under the
// `react-server` condition and a throwing module under `default`. Next.js applies the
// `react-server` condition during its server build so `import "server-only"` is a no-op there;
// plain Node (tsx) uses `default`, which throws. We can't globally pass `--conditions
// react-server` because that also routes `react` to its RSC build (no `createContext`),
// breaking packages like lucide-react.
//
// Instead, this script patches `Module._resolveFilename` to point `server-only` at this empty
// CJS stub. Mirrors the alias vitest uses (`src/tests/stubs/server-only.ts`).
module.exports = {};
