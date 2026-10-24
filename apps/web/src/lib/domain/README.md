# Browser-safe domain contracts

This directory contains pure calculations, schemas, permission checks, DTOs, and enums used
by both the web UI and web server. It must not import server, feature, route, or application
implementation code. Feature-specific form behavior stays in its feature.

Database enum parity is checked by `server/infrastructure/db/contract-compatibility.ts` during
TypeScript validation. Code already shared with the native app belongs in `@soletrade/contracts`;
web-only models stay here.
