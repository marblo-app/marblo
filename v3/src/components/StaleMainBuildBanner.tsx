/**
 * "The main process is running older code — restart" notice
 * (ticket 4HMJGUJBo0tKPU4mgHyr).
 *
 * WHY THIS IS ON SCREEN AND NOT IN A LOG: on 2026-09-05 this exact condition
 * cost three debugging sessions (#1418, #1420, #1422), and in every one of them
 * the evidence existed — process start time, dist mtime — but lived somewhere
 * nobody looks. Half of that day's problem was "it was recorded and no one saw
 * it". A log line would have reproduced the failure it is meant to end, so the
 * report comes to the window instead.
 *
 * TONE: this reads as guidance, not as an error. The heading states the FIX
 * ("restarting will fix this") before the symptom, the palette is the same
 * informational blue as an available update rather than the error red, and the
 * changed module names are included so the reader also learns WHAT has not
 * taken effect — on the day this was written the answer people needed was
 * literally "local-models.js".
 *
 * NO RESTART BUTTON, deliberately. `npm run dev` runs electron under
 * `concurrently -k` via `scripts/dev-electron.mjs`, which calls `process.exit`
 * when its electron child closes — so quitting the app takes vite and
 * `tsc --watch` down with it, and an `app.relaunch()` would come back to a dead
 * dev server and a blank window. The honest affordance is the exact command to
 * re-run, which is what the banner prints.
 *
 * Dev-only in practice: the main process never starts the watcher in a packaged
 * app (see electron/main-build-scan.ts), so `report` stays null there and this
 * renders nothing.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "../lib/i18n";
import {
  parseMainBuildReport,
  shouldShowStaleBuildBanner,
  summarizeChangedModules,
  type MainBuildReport,
} from "../lib/staleMainBuild";

export function StaleMainBuildBanner() {
  const { t } = useTranslation();
  const [report, setReport] = useState<MainBuildReport | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const api = window.electronAPI?.system;
    if (!api) return;

    let cancelled = false;
    // Pull once: the main process may have gone stale before this component
    // mounted (a full renderer reload re-runs this effect long after boot),
    // and a push-only wiring would miss that window entirely.
    void api
      .mainBuildFreshness?.()
      .then((raw) => {
        if (cancelled) return;
        const parsed = parseMainBuildReport(raw);
        if (parsed) setReport(parsed);
      })
      .catch(() => {
        // An older main process without this handler rejects — nothing to show.
      });

    api.onMainBuildStale?.((raw) => {
      const parsed = parseMainBuildReport(raw);
      if (parsed) setReport(parsed);
    });

    return () => {
      cancelled = true;
      api.offMainBuildStale?.();
    };
  }, []);

  if (!shouldShowStaleBuildBanner({ report, dismissed })) return null;

  const { names, overflowCount } = summarizeChangedModules(report);
  const moduleList =
    names.length === 0
      ? null
      : overflowCount > 0
        ? t("devBuild.staleModulesOverflow", {
            modules: names.join(", "),
            count: overflowCount,
          })
        : names.join(", ");

  return (
    <div
      className="flex items-start gap-3 border-b border-accent/30 bg-accent/10 px-4 py-2 text-xs"
      role="status"
    >
      <span aria-hidden="true" className="mt-px">
        🔄
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-accent">
          <span className="font-medium">{t("devBuild.staleTitle")}</span>
          <span className="ml-2 text-secondary">
            {t("devBuild.staleAction")}
          </span>
        </div>
        <div className="mt-0.5 text-muted">{t("devBuild.staleBody")}</div>
        {moduleList && (
          <div className="mt-0.5 truncate text-muted" title={moduleList}>
            {t("devBuild.staleModules", { modules: moduleList })}
          </div>
        )}
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded px-2 py-1 text-muted transition-colors hover:text-primary"
      >
        {t("devBuild.dismiss")}
      </button>
    </div>
  );
}
