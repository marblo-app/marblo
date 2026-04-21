// Mock firebase/app for testing
export function initializeApp(_config?: unknown) {
  return { name: '[DEFAULT]' };
}

export function getApps() {
  return [{ name: '[DEFAULT]' }];
}
