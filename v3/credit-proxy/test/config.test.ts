import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ANTHROPIC_VERSION,
  DEFAULT_UPSTREAM_BASE_URL,
  describeConfigForLogging,
  loadConfigFromEnv,
} from "../src/config";

test("defaults are sane when nothing is set", () => {
  const config = loadConfigFromEnv({} as NodeJS.ProcessEnv);
  assert.equal(config.port, 8080);
  assert.equal(config.upstreamBaseUrl, DEFAULT_UPSTREAM_BASE_URL);
  assert.equal(config.defaultAnthropicVersion, DEFAULT_ANTHROPIC_VERSION);
  assert.equal(config.upstreamApiKey, "");
});

test("a trailing slash on the upstream base url does not become a double slash", () => {
  const config = loadConfigFromEnv({
    UPSTREAM_BASE_URL: "https://api.anthropic.com///",
  } as NodeJS.ProcessEnv);
  assert.equal(config.upstreamBaseUrl, "https://api.anthropic.com");
});

test("invalid numeric env falls back instead of producing NaN", () => {
  const config = loadConfigFromEnv({
    PORT: "not-a-port",
    MAX_BODY_BYTES: "-5",
  } as NodeJS.ProcessEnv);
  assert.equal(config.port, 8080);
  assert.equal(config.maxBodyBytes, 32 * 1024 * 1024);
});

test("★ the loggable shape never contains the credential", () => {
  const config = loadConfigFromEnv({
    ANTHROPIC_API_KEY: "sk-ant-super-secret-value",
  } as NodeJS.ProcessEnv);

  const described = describeConfigForLogging(config);
  const serialized = JSON.stringify(described);

  assert.equal(described.upstreamApiKeyPresent, true);
  assert.equal(serialized.includes("sk-ant"), false);
  assert.equal(serialized.includes("secret"), false);
  // Not even a prefix — a key prefix identifies the account.
  assert.equal(serialized.includes("sk-"), false);
});

test("absence of a credential is reported as false, not omitted", () => {
  const described = describeConfigForLogging(
    loadConfigFromEnv({} as NodeJS.ProcessEnv),
  );
  assert.equal(described.upstreamApiKeyPresent, false);
});
