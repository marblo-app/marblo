import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import { useAuth } from "../../hooks/useAuth";
import { useProjectStore } from "../../stores/projectStore";
import { useAgentStore } from "../../stores/agentStore";
import { submitBugReport } from "../../services/bugReportService";

interface BugReportModalProps {
  onClose: () => void;
}

// Firebase callable errors carry a `code` like "functions/unauthenticated".
function errorKey(err: unknown): string {
  const code =
    typeof err === "object" && err && "code" in err
      ? String((err as { code?: unknown }).code)
      : "";
  if (code === "functions/unauthenticated") {
    return "bugReport.modal.loginRequired";
  }
  if (code === "functions/resource-exhausted") {
    return "bugReport.modal.rateLimited";
  }
  return "bugReport.modal.errorGeneric";
}

export function BugReportModal({ onClose }: BugReportModalProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const currentProject = useProjectStore((s) => s.currentProject);
  const agents = useAgentStore((s) => s.agents);

  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Best-effort diagnostic context. Computed once on mount-ish; the agent
  // snapshot recomputes if the fleet changes while the modal is open.
  const appVersion =
    typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "unknown";
  const platform = window.electronAPI?.platform ?? "unknown";
  const route = currentProject
    ? `project:${currentProject.name}`
    : "no-project";

  const agentSnapshot = useMemo(() => {
    if (!agents.length) return "0 agents";
    const counts = agents.reduce<Record<string, number>>((acc, a) => {
      acc[a.status] = (acc[a.status] || 0) + 1;
      return acc;
    }, {});
    const summary = Object.entries(counts)
      .map(([s, n]) => `${n} ${s}`)
      .join(", ");
    const sample = agents
      .slice(0, 8)
      .map((a) => `${a.name}(${a.model}):${a.status}`)
      .join("; ");
    return `${agents.length} agents — ${summary}\n${sample}`;
  }, [agents]);

  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) {
      setError(t("bugReport.modal.required"));
      return;
    }
    if (!user) {
      setError(t("bugReport.modal.loginRequired"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await submitBugReport({
        description: description.trim(),
        appVersion,
        platform,
        context: { route, agentSnapshot },
      });
      setSuccess(true);
    } catch (err) {
      setError(t(errorKey(err) as Parameters<typeof t>[0]));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-gray-700 bg-gray-800 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-700 px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-100">
            🐛 {t("bugReport.modal.title")}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200"
            aria-label={t("bugReport.modal.close")}
          >
            ✕
          </button>
        </div>

        {success ? (
          <div className="space-y-4 p-6 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-500/15 text-2xl">
              ✓
            </div>
            <h3 className="text-base font-medium text-gray-100">
              {t("bugReport.modal.successTitle")}
            </h3>
            <p className="text-sm text-gray-400">
              {t("bugReport.modal.successBody")}
            </p>
            <button
              onClick={onClose}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
            >
              {t("bugReport.modal.close")}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 p-5">
            {error && (
              <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {error}
              </div>
            )}

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-300">
                {t("bugReport.modal.descriptionLabel")}
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                maxLength={5000}
                autoFocus
                className="w-full resize-none rounded border border-gray-600 bg-gray-700 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                placeholder={t("bugReport.modal.descriptionPlaceholder")}
              />
            </div>

            {/* Auto-attached context preview — transparency about what we send. */}
            <div className="rounded border border-gray-700 bg-gray-900/40 p-3">
              <p className="mb-2 text-xs font-medium text-gray-400">
                {t("bugReport.modal.contextHeading")}
              </p>
              <dl className="space-y-1 text-xs text-gray-500">
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-gray-600">
                    {t("bugReport.modal.appVersion")}
                  </dt>
                  <dd className="font-mono text-gray-400">{appVersion}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-gray-600">
                    {t("bugReport.modal.platform")}
                  </dt>
                  <dd className="font-mono text-gray-400">{platform}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-gray-600">
                    {t("bugReport.modal.route")}
                  </dt>
                  <dd className="font-mono text-gray-400">{route}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-gray-600">
                    {t("bugReport.modal.agents")}
                  </dt>
                  <dd className="whitespace-pre-wrap font-mono text-gray-400">
                    {agentSnapshot}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="rounded px-4 py-2 text-sm text-gray-400 hover:text-gray-200"
              >
                {t("bugReport.modal.cancel")}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
              >
                {submitting
                  ? t("bugReport.modal.submitting")
                  : t("bugReport.modal.submit")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
