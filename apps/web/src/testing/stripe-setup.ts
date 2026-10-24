import "./integration-setup";
import { validateIntegrationEnvironment } from "../../scripts/lib/integration-environment";

validateIntegrationEnvironment(process.env, true);
