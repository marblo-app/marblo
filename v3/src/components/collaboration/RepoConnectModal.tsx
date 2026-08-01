import { useEffect, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import { useProjectStore } from "../../stores/projectStore";
import { useEditorStore } from "../../stores/editorStore";
import { normalizeGitRemoteUrl } from "../../services/projectService";
import {
  shouldOfferRepoConnect,
  repoDirNameFromUrl,
} from "../../lib/repoConnect";
import telemetry from "../../services/telemetryService";
import type { MessageKey } from "../../locales/ko";

/**
 * 저장소 연결 모달 (티켓 r8VggohxLGciDVXV2rf6).
 *
 * 초대 수락한 멤버가 프로젝트에 진입했는데 이 기기에 rootPath 가 없으면
 * project.gitRemoteUrl 을 보여주고 [Clone & 연결] 원클릭을 제공한다.
 * ★완전 자동풀 아님 — clone 은 반드시 이 모달의 명시적 버튼으로만 실행된다.
 *
 * 노출 판정은 shouldOfferRepoConnect(순수 함수)가 담당한다: 이미 연결된
 * 멤버(resolution kind === "own")나 machineId 미도착 시점에는 절대 뜨지
 * 않아 기존 화면이 픽셀 단위로 불변이다.
 */

/** clone 실패 종류 → 안내 문구 키. */
const ERROR_KEY: Record<string, MessageKey> = {
  auth: "collab.repoConnect.errorAuth",
  "not-found": "collab.repoConnect.errorNotFound",
  network: "collab.repoConnect.errorNetwork",
  exists: "collab.repoConnect.errorExists",
  git: "collab.repoConnect.errorGeneric",
  "invalid-url": "collab.repoConnect.errorGeneric",
};

export function RepoConnectModal() {
  const { t } = useTranslation();
  const currentProject = useProjectStore((s) => s.currentProject);
  const machineId = useProjectStore((s) => s.machineId);
  const setFolderPathForThisMachine = useProjectStore(
    (s) => s.setFolderPathForThisMachine,
  );
  const setRootPath = useEditorStore((s) => s.setRootPath);

  // [나중에] — 이 창 세션 동안 프로젝트별로 다시 묻지 않는다(영속 아님:
  // 재시작하면 다시 안내한다. 연결 전까지는 실제로 코드 탭을 못 쓰므로).
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [parentDir, setParentDir] = useState<string | null>(null);
  const [defaultParent, setDefaultParent] = useState<string | null>(null);

  const visible =
    shouldOfferRepoConnect(currentProject, machineId) &&
    !!currentProject &&
    !dismissed.has(currentProject.id);

  // 모달이 뜰 때 기본 clone 위치(~/Marblo)를 한 번 받아와 표시한다.
  useEffect(() => {
    if (!visible || defaultParent) return;
    let cancelled = false;
    window.electronAPI.repo
      ?.defaultCloneParent()
      .then((dir) => {
        if (!cancelled && dir) setDefaultParent(dir);
      })
      .catch(() => {
        /* 구버전 main — 표시만 생략, clone 은 main 이 기본값을 다시 계산 */
      });
    return () => {
      cancelled = true;
    };
  }, [visible, defaultParent]);

  // 프로젝트가 바뀌면 이전 에러/위치 선택을 비운다.
  useEffect(() => {
    setErrorKey(null);
    setErrorDetail(null);
    setParentDir(null);
  }, [currentProject?.id]);

  if (!visible || !currentProject) return null;

  const repoUrl = currentProject.gitRemoteUrl!;
  const projectId = currentProject.id;
  const effectiveParent = parentDir ?? defaultParent;
  const destPreview = effectiveParent
    ? `${effectiveParent}/${repoDirNameFromUrl(repoUrl)}`
    : null;

  const fail = (key: MessageKey, detail?: string | null) => {
    setErrorKey(key);
    setErrorDetail(detail ?? null);
  };

  /** clone 성공/기존 폴더 선택 후 공통 연결: 내 기기 칸 기록 + rootPath. */
  const connectPath = async (localPath: string, mode: string) => {
    try {
      await setFolderPathForThisMachine(projectId, localPath);
    } catch {
      fail("collab.repoConnect.connectFailed");
      return;
    }
    setRootPath(localPath);
    telemetry.folderConnected(mode, true);
  };

  const handleClone = async () => {
    setBusy(true);
    setErrorKey(null);
    setErrorDetail(null);
    try {
      const result = await window.electronAPI.repo.clone({
        projectId,
        repoUrl,
        parentDir: effectiveParent,
      });
      if (result.ok && result.path) {
        await connectPath(result.path, "member-clone");
      } else {
        fail(
          ERROR_KEY[result.errorKind ?? "git"] ??
            "collab.repoConnect.errorGeneric",
          result.message,
        );
      }
    } catch (err) {
      fail(
        "collab.repoConnect.errorGeneric",
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleConnectExisting = async () => {
    setErrorKey(null);
    setErrorDetail(null);
    const dir = await window.electronAPI.fs.selectDirectory();
    if (!dir) return;
    setBusy(true);
    try {
      const origin = await window.electronAPI.fs.gitRemoteUrl(dir);
      if (!origin) {
        fail("collab.repoConnect.errorNoRemote");
        return;
      }
      if (normalizeGitRemoteUrl(origin) !== normalizeGitRemoteUrl(repoUrl)) {
        fail("collab.repoConnect.errorMismatch", origin);
        return;
      }
      // 이 머신의 연결 단일 진실원에도 기록(fail-soft — Harness 탭 소비용).
      window.electronAPI.connection
        .upsert({ projectId, localPath: dir })
        .catch(() => {});
      await connectPath(dir, "member-existing");
    } finally {
      setBusy(false);
    }
  };

  const handleLater = () => {
    setDismissed((prev) => new Set(prev).add(projectId));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-lg rounded-lg bg-gray-800 border border-gray-700 shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-700 px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-100">
            {t("collab.repoConnect.title")}
          </h2>
          <button
            onClick={handleLater}
            disabled={busy}
            className="text-gray-400 hover:text-gray-200 disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-300">
            {t("collab.repoConnect.description")}
          </p>

          <div>
            <div className="mb-1 text-xs font-medium text-gray-400">
              {t("collab.repoConnect.repoLabel")}
            </div>
            <div className="rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-gray-200 font-mono break-all">
              {repoUrl}
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-gray-400">
                {t("collab.repoConnect.locationLabel")}
              </span>
              <button
                onClick={() => {
                  void window.electronAPI.fs.selectDirectory().then((dir) => {
                    if (dir) setParentDir(dir);
                  });
                }}
                disabled={busy}
                className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50"
              >
                {t("collab.repoConnect.changeLocation")}
              </button>
            </div>
            <div className="rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-gray-300 font-mono break-all">
              {destPreview ?? "…"}
            </div>
          </div>

          {errorKey && (
            <div className="rounded bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm text-red-400">
              <div>{t(errorKey)}</div>
              {errorDetail && (
                <div className="mt-1 text-xs text-red-400/70 break-all">
                  {errorDetail}
                </div>
              )}
            </div>
          )}

          <p className="text-xs text-gray-500">
            {t("collab.repoConnect.privateHint")}
          </p>

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              onClick={handleLater}
              disabled={busy}
              className="rounded px-3 py-2 text-sm text-gray-400 hover:text-gray-200 disabled:opacity-50"
            >
              {t("collab.repoConnect.later")}
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void handleConnectExisting()}
                disabled={busy}
                className="rounded border border-gray-600 px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 disabled:opacity-50"
              >
                {t("collab.repoConnect.connectExisting")}
              </button>
              <button
                onClick={() => void handleClone()}
                disabled={busy}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {busy
                  ? t("collab.repoConnect.cloning")
                  : t("collab.repoConnect.cloneAndConnect")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
