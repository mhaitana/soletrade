// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isCronAuthorized } from "@/server/application/jobs/cron-auth";

const h = vi.hoisted(() => ({ env: { CRON_SECRET: "cron-secret" as string | undefined } }));
vi.mock("@/server/infrastructure/config/env", () => ({ env: h.env }));

function request(headers: Record<string, string>): Request {
  return new Request("https://app.example.test/api/cron/example", { headers });
}

beforeEach(() => {
  h.env.CRON_SECRET = "cron-secret";
});

describe("isCronAuthorized", () => {
  it("accepts the configured secret as a bearer token or in x-cron-secret", () => {
    expect(isCronAuthorized(request({ authorization: "Bearer cron-secret" }))).toBe(true);
    expect(isCronAuthorized(request({ "x-cron-secret": "cron-secret" }))).toBe(true);
  });

  it("rejects a wrong secret of the same length", () => {
    expect(isCronAuthorized(request({ authorization: "Bearer cron-secreX" }))).toBe(false);
    expect(isCronAuthorized(request({ "x-cron-secret": "Xron-secret" }))).toBe(false);
  });

  it("rejects a wrong secret of a different length", () => {
    // A shorter or longer value must never pass just because its length differs.
    for (const wrong of ["x", "cron-secre", "cron-secret-and-more", "wrong-secret"]) {
      expect(isCronAuthorized(request({ authorization: `Bearer ${wrong}` }))).toBe(false);
      expect(isCronAuthorized(request({ "x-cron-secret": wrong }))).toBe(false);
    }
  });

  it("rejects a missing, empty or malformed credential", () => {
    expect(isCronAuthorized(request({}))).toBe(false);
    expect(isCronAuthorized(request({ authorization: "Bearer " }))).toBe(false);
    expect(isCronAuthorized(request({ authorization: "cron-secret" }))).toBe(false);
    expect(isCronAuthorized(request({ authorization: "Basic cron-secret" }))).toBe(false);
    expect(isCronAuthorized(request({ "x-cron-secret": "" }))).toBe(false);
  });

  it("rejects everything when no secret is configured", () => {
    h.env.CRON_SECRET = undefined;
    expect(isCronAuthorized(request({ authorization: "Bearer cron-secret" }))).toBe(false);
    expect(isCronAuthorized(request({ authorization: "Bearer " }))).toBe(false);
    expect(isCronAuthorized(request({}))).toBe(false);
  });
});
