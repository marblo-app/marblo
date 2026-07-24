/**
 * Environment tagging is **operational config**, not a label.
 *
 * Sentry alerting is an allowlist: `environment:production` pages the CEO,
 * everything else lands in the project silently. That makes two failures
 * possible, and this file pins both:
 *
 *   - **Under-block** (an event wrongly tagged `production`) → dev/E2E noise
 *     mails the CEO and buries real crash signal. This is what actually
 *     happened: a headless probe from the preload-bundle ticket (zTwKGyav)
 *     sent an error to the shared production DSN and generated a page.
 *   - **Over-block** (a real production event tagged anything else) → strictly
 *     worse: user crashes stop paging anyone, silently. Sentry was already
 *     dead-on-arrival once for the whole product's life (#583) precisely
 *     because nothing was watching.
 *
 * See v3/docs/SENTRY-RUNBOOK.md §5.
 */
import { describe, it, expect } from "vitest";

import {
  resolveSentryEnvironment,
  PRODUCTION_ENVIRONMENT,
  DEVELOPMENT_ENVIRONMENT,
} from "../../src/lib/telemetry/sentry";

describe("resolveSentryEnvironment (renderer)", () => {
  it("★ a production build tags exactly `production` — the literal alert rules match", () => {
    // If this literal ever drifts, the allowlist rule stops matching and real
    // user crashes page nobody. Change it here and you must change the Sentry
    // alert rule in the same breath (runbook §5.3).
    expect(PRODUCTION_ENVIRONMENT).toBe("production");
    expect(resolveSentryEnvironment(undefined, true)).toBe("production");
    expect(resolveSentryEnvironment("production", true)).toBe("production");
  });

  it("★ a dev server can never claim `production`, even if .env says so", () => {
    // The runbook's own snippet for v3/.env used to print
    // VITE_SENTRY_ENVIRONMENT=production, so this misconfiguration is one
    // copy-paste away.
    expect(resolveSentryEnvironment("production", false)).toBe(
      DEVELOPMENT_ENVIRONMENT,
    );
    expect(resolveSentryEnvironment("PRODUCTION", false)).toBe(
      DEVELOPMENT_ENVIRONMENT,
    );
    expect(resolveSentryEnvironment("  production  ", false)).toBe(
      DEVELOPMENT_ENVIRONMENT,
    );
  });

  it("defaults to development when nothing is configured on a dev build", () => {
    expect(resolveSentryEnvironment(undefined, false)).toBe("development");
    expect(resolveSentryEnvironment("", false)).toBe("development");
    expect(resolveSentryEnvironment("   ", false)).toBe("development");
  });

  it("normalizes casing/whitespace so exact-match alert rules hold", () => {
    expect(resolveSentryEnvironment(" Production ", true)).toBe("production");
    expect(resolveSentryEnvironment("PROBE", false)).toBe("probe");
  });

  it("honours custom non-production tags (probe, staging) on dev builds", () => {
    expect(resolveSentryEnvironment("probe", false)).toBe("probe");
    expect(resolveSentryEnvironment("staging", false)).toBe("staging");
  });
});
