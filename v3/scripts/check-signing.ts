/**
 * Marblo Pre-Build Signing Verification
 *
 * Checks that code signing credentials are configured before building.
 * Usage: npx ts-node scripts/check-signing.ts [--mac] [--win] [--all]
 */

import fs from "fs";
import path from "path";

interface CheckResult {
  name: string;
  status: "ok" | "warn" | "missing";
  message: string;
}

function checkMac(): CheckResult[] {
  const results: CheckResult[] = [];

  const appleId = process.env.APPLE_ID;
  const appPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  results.push({
    name: "APPLE_ID",
    status: appleId ? "ok" : "warn",
    message: appleId
      ? `Set (${appleId.replace(/(.{3}).*(@.*)/, "$1***$2")})`
      : "Not set - notarization will be skipped",
  });

  results.push({
    name: "APPLE_APP_SPECIFIC_PASSWORD",
    status: appPassword ? "ok" : "warn",
    message: appPassword
      ? "Set"
      : "Not set - notarization will be skipped",
  });

  results.push({
    name: "APPLE_TEAM_ID",
    status: teamId ? "ok" : "warn",
    message: teamId ? `Set (${teamId})` : "Not set - notarization will be skipped",
  });

  // Check entitlements file
  const entitlementsPath = path.resolve(
    __dirname,
    "..",
    "resources",
    "entitlements.mac.plist"
  );
  results.push({
    name: "entitlements.mac.plist",
    status: fs.existsSync(entitlementsPath) ? "ok" : "missing",
    message: fs.existsSync(entitlementsPath)
      ? `Found at ${entitlementsPath}`
      : `Missing: ${entitlementsPath}`,
  });

  return results;
}

function checkWin(): CheckResult[] {
  const results: CheckResult[] = [];

  const certFile = process.env.WIN_CSC_LINK;
  const certPassword = process.env.WIN_CSC_KEY_PASSWORD;

  results.push({
    name: "WIN_CSC_LINK",
    status: certFile ? "ok" : "warn",
    message: certFile
      ? "Set"
      : "Not set - Windows builds will be unsigned",
  });

  results.push({
    name: "WIN_CSC_KEY_PASSWORD",
    status: certPassword ? "ok" : "warn",
    message: certPassword
      ? "Set"
      : "Not set - Windows builds will be unsigned",
  });

  // If WIN_CSC_LINK is a file path, verify it exists
  if (certFile && !certFile.startsWith("http") && !certFile.startsWith("base64:")) {
    const certPath = path.resolve(certFile);
    results.push({
      name: "Certificate file",
      status: fs.existsSync(certPath) ? "ok" : "missing",
      message: fs.existsSync(certPath)
        ? `Found at ${certPath}`
        : `Not found: ${certPath}`,
    });
  }

  return results;
}

function printResults(platform: string, results: CheckResult[]) {
  console.log(`\n--- ${platform} Signing ---`);
  for (const r of results) {
    const icon =
      r.status === "ok" ? "✅" : r.status === "warn" ? "⚠️ " : "❌";
    console.log(`  ${icon} ${r.name}: ${r.message}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const checkAll = args.includes("--all") || args.length === 0;
  const checkMacFlag = checkAll || args.includes("--mac");
  const checkWinFlag = checkAll || args.includes("--win");

  console.log("🔍 Marblo Code Signing Check\n");

  let hasErrors = false;

  if (checkMacFlag) {
    const macResults = checkMac();
    printResults("macOS (Notarization)", macResults);
    if (macResults.some((r) => r.status === "missing")) hasErrors = true;
  }

  if (checkWinFlag) {
    const winResults = checkWin();
    printResults("Windows (Code Signing)", winResults);
    if (winResults.some((r) => r.status === "missing")) hasErrors = true;
  }

  console.log("");

  if (hasErrors) {
    console.log("❌ Some required files are missing. Fix issues above before building.");
    process.exit(1);
  } else {
    console.log("✅ Signing check passed. Ready to build.");
  }
}

main();
