import { loadEnvFile } from "node:process";
import { resolve } from "node:path";
import { validateIntegrationEnvironment } from "../../scripts/lib/integration-environment";
import { webRoot } from "./paths";

// An explicit integration configuration is mandatory; .env.local is never loaded.
const file = process.env.INTEGRATION_ENV_FILE;
if (!file) throw new Error("Set INTEGRATION_ENV_FILE to a disposable local test environment file.");
loadEnvFile(resolve(webRoot, file));
validateIntegrationEnvironment(process.env);
