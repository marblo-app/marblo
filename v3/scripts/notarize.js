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
 * If credentials are missing, notarization is skipped with a warning.
 */

/** @param {import("electron-builder").AfterPackContext} context */
module.exports = async function notarizing(context) {
  const [{ notarize }, path] = await Promise.all([
    import("@electron/notarize"),
    import("node:path"),
  ]);
  const { electronPlatformName, appOutDir } = context;

  // Only notarize macOS builds
  if (electronPlatformName !== "darwin") {
    return;
  }

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.log(
      "⚠️  Skipping notarization: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, or APPLE_TEAM_ID not set"
    );
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`🔏 Notarizing ${appPath} ...`);

  try {
    await notarize({
      tool: "notarytool",
      appPath,
      appleId,
      appleIdPassword,
      teamId,
    });
    console.log(`✅ Notarization complete for ${appName}`);
  } catch (error) {
    console.error("❌ Notarization failed:", error);
    throw error;
  }
};
