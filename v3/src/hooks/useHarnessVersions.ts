import { useEffect, useState } from "react";
import type { ModelType } from "../types/agent";

/** Installed CLI version per agent model (e.g. { claude: "2.1.163", gpt: "0.137.0" }). */
type VersionMap = Record<string, string>;

// Session-level cache: resolved once in the main process and shared across
// every card rather than re-invoked per mount. Fast/offline, so this is cheap.
let cache: VersionMap | null = null;
let inflight: Promise<VersionMap> | null = null;

/** Fetch (once) the installed-version map for all managed CLIs. */
export function useHarnessVersions(): VersionMap | null {
  const [versions, setVersions] = useState<VersionMap | null>(cache);
  useEffect(() => {
    if (cache) {
      setVersions(cache);
      return;
    }
    if (!inflight) {
      inflight = window.electronAPI.claude
        .cliVersions()
        .then((v) => {
          cache = v;
          return v;
        })
        .catch(() => {
          inflight = null; // allow a later retry
          return {} as VersionMap;
        });
    }
    let alive = true;
    inflight.then((v) => {
      if (alive) setVersions(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  return versions;
}

/** Resolve the installed version string for a model, or null if not detectable. */
export function harnessVersionForModel(
  versions: VersionMap | null,
  model: ModelType,
): string | null {
  return versions?.[model] || null;
}
