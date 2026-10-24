import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Unit tests never load development credentials or probe external services.
afterEach(cleanup);
