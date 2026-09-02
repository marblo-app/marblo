import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { readFileSync } from "fs";
import { DEV_SERVER_PORT } from "./electron/dev-server-origin";

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
    // ★포트는 electron/dev-server-origin.ts 한 곳에서만 정한다. electron 이
    // loadURL 하는 origin(http://localhost:5173)과 dev 런처의 readiness 프로브가
    // 같은 상수를 읽으므로 셋이 갈라질 수 없다 (티켓 L1LQjuQhRiW2hIoBkOAs).
    port: DEV_SERVER_PORT,
    // ★strictPort: 이 포트를 못 잡으면 조용히 5174 로 밀려나지 말고 그 자리에서
    // 죽어라. electron 은 언제나 5173 을 로드하므로, 밀려난 vite 는 "내 코드가
    // 아닌 다른 인스턴스의 렌더러가 뜨는" 조용한 오작동이 된다. 사장님은 Marblo
    // 인스턴스를 2~3개 동시에 띄우므로 이 분기는 이론이 아니라 상시 상황이다.
    strictPort: true,
    hmr: {
      // Prevent full page reload when HMR WebSocket disconnects (e.g. after sleep)
      // Vite will silently retry the connection instead of reloading
      timeout: 60000,
      overlay: false,
    },
  },
});
