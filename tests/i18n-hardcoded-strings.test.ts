/**
 * @file tests/i18n-hardcoded-strings.test.ts
 * @summary Vitest test — scans ALL source files for hardcoded UI strings
 *          that should use translation keys (t() / tx() / tPlural).
 *
 * This is a programmatic wrapper around tooling/audit-i18n.mjs.
 * Run with: npx vitest run tests/i18n-hardcoded-strings.test.ts
 */

import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { resolve } from "path";

const AUDIT_SCRIPT = resolve(__dirname, "../tooling/audit-i18n.mjs");

describe("i18n — no hardcoded UI strings", () => {
  it("all user-facing strings should use translation keys", () => {
    let output: string;
    try {
      output = execSync(`node "${AUDIT_SCRIPT}" --extended`, {
        cwd: resolve(__dirname, ".."),
        encoding: "utf-8",
        stdio: "pipe",
      });
    } catch (err: unknown) {
      // The script exits 1 in --strict mode; we're NOT using --strict here
      // so we capture all output.
      const stdout =
        typeof err === "object" && err !== null && "stdout" in err
          ? (err as { stdout?: unknown }).stdout
          : undefined;
      const message = err instanceof Error ? err.message : String(err);

      if (typeof stdout === "string") {
        output = stdout;
      } else if (stdout instanceof Uint8Array) {
        output = Buffer.from(stdout).toString("utf-8");
      } else {
        output = message;
      }
    }

    // Count violations from the output
    const match = output.match(/Total: (\d+) hardcoded string/);
    const count = match ? parseInt(match[1], 10) : 0;

    // Print the full report for visibility
    console.log(output);

    if (count > 0) {
      // Fail the test with the full report
      expect.fail(
        `Found ${count} hardcoded UI string(s). See report above for details. ` +
          `Each hardcoded string should use t() / tx() / tPlural() with a key in en-base.json.`
      );
    } else {
      expect(count).toBe(0);
    }
  });
});
