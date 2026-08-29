import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";

type SharedProjectRepoStatus =
  | "noRepo"
  | "notDownloaded"
  | "downloading"
  | "downloaded";

export interface FirstSharedProjectModalViewProps {
  projectName: string;
  hasRepoRemote: boolean;
  needsRepoConnect: boolean;
  isRepoConnecting?: boolean;
  onClose: () => void;
  onConnectRepo: () => void;
}

const FEATURE_KEYS: readonly MessageKey[] = [
  "collab.firstShared.feature.board",
  "collab.firstShared.feature.history",
  "collab.firstShared.feature.activity",
];

const STATUS_TITLE_KEY: Record<SharedProjectRepoStatus, MessageKey> = {
  noRepo: "collab.firstShared.repoStatus.noRepo.title",
  notDownloaded: "collab.firstShared.repoStatus.notDownloaded.title",
  downloading: "collab.firstShared.repoStatus.downloading.title",
  downloaded: "collab.firstShared.repoStatus.downloaded.title",
};

const STATUS_BODY_KEY: Record<SharedProjectRepoStatus, MessageKey> = {
  noRepo: "collab.firstShared.repoStatus.noRepo.body",
  notDownloaded: "collab.firstShared.repoStatus.notDownloaded.body",
  downloading: "collab.firstShared.repoStatus.downloading.body",
  downloaded: "collab.firstShared.repoStatus.downloaded.body",
};

function repoStatus({
  hasRepoRemote,
  needsRepoConnect,
  isRepoConnecting,
}: Pick<
  FirstSharedProjectModalViewProps,
  "hasRepoRemote" | "needsRepoConnect" | "isRepoConnecting"
>): SharedProjectRepoStatus {
  if (isRepoConnecting) return "downloading";
  if (!needsRepoConnect) return "downloaded";
  return hasRepoRemote ? "notDownloaded" : "noRepo";
}

export function FirstSharedProjectModalView({
  projectName,
  hasRepoRemote,
  needsRepoConnect,
  isRepoConnecting = false,
  onClose,
  onConnectRepo,
}: FirstSharedProjectModalViewProps) {
  const { t } = useTranslation();
  const status = repoStatus({
    hasRepoRemote,
    needsRepoConnect,
    isRepoConnecting,
  });
  const connectLabelKey: MessageKey =
    status === "downloading"
      ? "collab.firstShared.cta.downloading"
      : status === "notDownloaded"
        ? "collab.firstShared.cta.notDownloaded"
        : "collab.firstShared.cta.noRepo";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-shared-project-title"
        className="w-full max-w-xl rounded-lg border border-gray-700 bg-gray-800 shadow-2xl"
      >
        <div className="border-b border-gray-700 px-5 py-4">
          <p className="text-xs font-medium uppercase text-blue-300">
            {t("collab.firstShared.eyebrow")}
          </p>
          <h2
            id="first-shared-project-title"
            className="mt-1 text-lg font-semibold text-gray-100"
          >
            {projectName}
          </h2>
        </div>

        <div className="space-y-4 px-5 py-5">
          <p className="text-sm leading-6 text-gray-300">
            {t("collab.firstShared.body")}
          </p>

          <div className="grid gap-2 sm:grid-cols-3">
            {FEATURE_KEYS.map((key) => (
              <div
                key={key}
                className="rounded border border-blue-500/25 bg-blue-500/10 px-3 py-2 text-sm text-blue-100"
              >
                {t(key)}
              </div>
            ))}
          </div>

          <div className="rounded border border-gray-700 bg-gray-900/70 px-3 py-3">
            <p className="text-sm font-medium text-gray-200">
              {t("collab.firstShared.localCode.title")}
            </p>
            <p className="mt-1 text-xs leading-5 text-gray-400">
              {t("collab.firstShared.localCode.body")}
            </p>
          </div>

          <div className="rounded border border-gray-700 bg-gray-900/70 px-3 py-3">
            <p className="text-sm font-medium text-gray-200">
              {t(STATUS_TITLE_KEY[status])}
            </p>
            <p className="mt-1 text-xs leading-5 text-gray-400">
              {t(STATUS_BODY_KEY[status])}
            </p>
          </div>

          <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-xs leading-5 text-amber-100">
            {t("collab.firstShared.conflictHint")}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <div className="flex items-center gap-2">
              {needsRepoConnect && (
                <button
                  type="button"
                  onClick={onConnectRepo}
                  disabled={isRepoConnecting}
                  className="rounded border border-blue-500/60 px-3 py-2 text-sm font-medium text-blue-200 hover:bg-blue-500/10"
                >
                  {t(connectLabelKey)}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500"
              >
                {t("collab.firstShared.gotIt")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
