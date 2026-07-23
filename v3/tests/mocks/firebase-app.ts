// Mock firebase/app for testing
export function initializeApp(_config?: unknown) {
  return { name: "[DEFAULT]" };
}

export function getApps() {
  return [{ name: "[DEFAULT]" }];
}

// firebase.ts uses `getApps().length ? getApp() : initializeApp(...)` to reuse
// an existing app on a hot reload; the reuse branch needs getApp here too.
export function getApp() {
  return { name: "[DEFAULT]" };
}
