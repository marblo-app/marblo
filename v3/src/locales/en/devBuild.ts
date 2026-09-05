/**
 * English — `devBuild.*` namespace. Typed against the ko counterpart so key
 * drift is a compile-time error.
 */
import type { devBuild as koDevBuild } from "../ko/devBuild";

export const devBuild: Record<keyof typeof koDevBuild, string> = {
  "devBuild.staleTitle": "Restarting the app will fix this",
  "devBuild.staleBody":
    "The window has reloaded with the latest code, but the main process is still running the code it started with. Recent changes may not show up, and lists may look empty.",
  "devBuild.staleAction": "Re-run npm run dev in your terminal.",
  "devBuild.staleModules": "Waiting on a restart: {modules}",
  "devBuild.staleModulesOverflow": "{modules} and {count} more",
  "devBuild.dismiss": "Dismiss",
};
