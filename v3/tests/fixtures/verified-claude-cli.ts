import { afterEach, beforeEach } from "vitest";
import { setClaudeBinaryResolverForTesting } from "../../electron/agent-config";

/**
 * Model-policy integration tests exercise argv selection, not the host's
 * managed Claude installation. Keep that external installation explicit.
 */
export function useVerifiedClaudeCli(): void {
  beforeEach(() => {
    setClaudeBinaryResolverForTesting(() => ({
      command: "claude",
      version: "2.1.220",
    }));
  });

  afterEach(() => {
    setClaudeBinaryResolverForTesting(null);
  });
}
