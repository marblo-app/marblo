// @ts-check

/**
 * Marblo macOS Notarization Script (afterSign hook for electron-builder)
 *
 * Required environment variables:
 *   APPLE_ID                    - Apple Developer account email
 *   APPLE_APP_SPECIFIC_PASSWORD - App-specific password (generate at appleid.apple.com)
 *   APPLE_TEAM_ID               - Apple Developer Team ID (10-char alphanumeric)
 *
 * This script runs automatically after code signing via electron-builder's afterSign hook.
 * If credentials are missing, notarization is skipped with a warning unless
 * MARBLO_REQUIRE_MAC_NOTARIZATION=true is set.
 */

/** @param {import("electron-builder").AfterPackContext} context */
module.exports = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  // Only notarize macOS builds
  if (electronPlatformName !== "darwin") {
    return;
  }

  // electron-builder skips code signing on pull-request builds, producing an
  // ad-hoc-signed app. Notarization requires a real Developer ID signature, so
  // it would fail ("code has no resources but signature indicates they must be
  // present"). Skip notarization for PR verification builds — release builds
  // (tag push / workflow_dispatch / branch push) still sign and notarize.
  if (process.env.GITHUB_EVENT_NAME === "pull_request") {
    console.log(
      "⚠️  Skipping notarization: pull-request build (code signing is skipped on PRs)"
    );
    return;
  }

  const credentials = {
    APPLE_ID: process.env.APPLE_ID,
    APPLE_APP_SPECIFIC_PASSWORD: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    APPLE_TEAM_ID: process.env.APPLE_TEAM_ID,
  };
  const missingCredentials = Object.entries(credentials)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  const requireNotarization =
    process.env.MARBLO_REQUIRE_MAC_NOTARIZATION === "true";

  if (missingCredentials.length > 0) {
    const message = `Skipping notarization: missing ${missingCredentials.join(
      ", "
    )}`;
    if (requireNotarization) {
      throw new Error(message);
    }
    console.log(`⚠️  ${message}`);
    return;
  }

  const [{ notarize }, path] = await Promise.all([
    import("@electron/notarize"),
    import("node:path"),
  ]);
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`🔏 Notarizing ${appPath} ...`);

  try {
    await notarize({
      tool: "notarytool",
      appPath,
      appleId: credentials.APPLE_ID,
      appleIdPassword: credentials.APPLE_APP_SPECIFIC_PASSWORD,
      teamId: credentials.APPLE_TEAM_ID,
    });
    console.log(`✅ Notarization complete for ${appName}`);
  } catch (error) {
    console.error("❌ Notarization failed:", error);
    throw error;
  }
};
