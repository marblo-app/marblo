#!/usr/bin/env node
/*
 * Emit build-resources/oauth-config.json for the packaged app (ticket
 * QvaYPAjAW822I0IDiwwZ, Google 로그인 B안 loopback OAuth).
 *
 * Why this exists (Codex 독립검증이 잡은 실버그):
 *   The packaged DMG ships no `.env`, so the main process's
 *   `process.env.VITE_GOOGLE_DESKTOP_OAUTH_CLIENT_ID` /
 *   `GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET` are empty at runtime and the loopback
 *   flow fails immediately (google-oauth.ts guards on a missing client id)
 *   before the browser ever opens. The renderer's precheck passes only because
 *   Vite inlines the client id at build time — main never gets it.
 *
 * Fix: bundle ONLY the two Google OAuth values as a tiny extraResource that
 * main reads at boot. We deliberately do NOT ship the whole `.env` — it also
 * holds Toss/Resend and other secrets that must never land in the DMG. This
 * file (build-resources/) is gitignored so the values never get committed.
 *
 * Runs at the tail of `build:electron` (after vite build). Missing values are
 * written as empty strings so a dev/CI build without the secrets still produces
 * a valid (inert) file — main then just falls back to the .env path.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
// scripts/ lives directly under the v3 package root.
const ROOT = resolve(__dirname, "..");

// Load the local .env into process.env (no-op if it doesn't exist, e.g. CI that
// injects the vars directly into the environment instead).
dotenv.config({ path: resolve(ROOT, ".env") });

// EXACTLY the two Google OAuth keys — nothing else from .env is copied.
const config = {
  clientId: process.env.VITE_GOOGLE_DESKTOP_OAUTH_CLIENT_ID || "",
  clientSecret: process.env.GOOGLE_DESKTOP_OAUTH_CLIENT_SECRET || "",
  githubClientId: process.env.GITHUB_OAUTH_CLIENT_ID || "",
};

const outDir = resolve(ROOT, "build-resources");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, "oauth-config.json");
writeFileSync(outPath, JSON.stringify(config, null, 2) + "\n");

const present = [
  config.clientId ? "clientId" : null,
  config.clientSecret ? "clientSecret" : null,
  config.githubClientId ? "githubClientId" : null,
].filter(Boolean);
console.log(
  `[write-oauth-config] wrote ${outPath} (${
    present.length
      ? present.join(", ") + " set"
      : "both empty — dev/CI fallback"
  })`,
);
