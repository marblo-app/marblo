import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { readFileSync } from "fs";

// Installed app version, read from package.json at config time. Injected as a
// renderer-visible constant (__APP_VERSION__) so the bug-report context
// collector can stamp it without an extra main-process IPC.
const appVersion =
  (
    JSON.parse(
      readFileSync(path.resolve(__dirname, "package.json"), "utf-8"),
    ) as { version?: string }
  ).version ?? "0.0.0";

export default defineConfig({
  plugins: [react()],
  root: "src",
  base: "./",
  envDir: path.resolve(__dirname),
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    hmr: {
      // Prevent full page reload when HMR WebSocket disconnects (e.g. after sleep)
      // Vite will silently retry the connection instead of reloading
      timeout: 60000,
      overlay: false,
    },
  },
});
