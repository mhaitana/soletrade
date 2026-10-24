# Shared contracts

Platform-independent API schemas, types, currencies and calculations consumed by web and mobile.

Use the curated exports `@soletrade/contracts/mobile`, `/currencies`, `/business-income`, `/home-overview` and `/design-tokens`. The root export remains available for existing callers. Do not import `src/` paths across package boundaries.

This package depends on Zod only at runtime. It must not import application code, React, Next.js, React Native, Expo, filesystem APIs or environment configuration. Apps compile its TypeScript sources with their own toolchains.

Run `pnpm --filter @soletrade/contracts check` for type checking, lint and unit tests.
