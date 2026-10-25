import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve filesystem paths without Vite's static new-URL asset transformation.
const testingDirectory = dirname(fileURLToPath(import.meta.url));

export const webRoot = resolve(testingDirectory, "../..");
export const repositoryRoot = resolve(testingDirectory, "../../../..");
