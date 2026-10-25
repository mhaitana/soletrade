import path from "node:path";

// Playwright loads configuration and setup through its CommonJS transformer.
export const webRoot = path.resolve(__dirname, "../..");
export const repositoryRoot = path.resolve(webRoot, "../..");
