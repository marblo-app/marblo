import { useEffect, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import { useProjectStore } from "../../stores/projectStore";
import { useEditorStore } from "../../stores/editorStore";
import { normalizeGitRemoteUrl } from "../../services/projectService";
import {
  shouldOfferRepoConnect,
  repoConnectMode,
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
 *
 * 두 모드 (티켓 r8vIviEcwHFbFJ88RqZ7):
 *  - `clone`  — 프로젝트가 repo 주소를 안다. 기존 동작 그대로.
 *  - `manual` — 주소를 모른다(owner 가 한 번도 로컬 git 폴더를 안 붙인
 *    프로젝트). 예전엔 이 경우 모달이 아예 안 떠서 멤버가 코드에 손도 못
 *    댔다. 이제 주소 입력란을 띄우고, [기존 폴더 연결]은 고른 폴더의 origin
 *    을 그대로 채택한다. 어느 쪽이든 확인된 주소를 프로젝트에 backfill 해
 *    다음 멤버부터는 clone 모드가 된다.
 */

/** clone 실패 종류 → 안내 문구 키. */
const ERROR_KEY: Record<string, MessageKey> = {
  auth: "collab.repoConnect.errorAuth",
  "not-found": "collab.repoConnect.errorNotFound",
  network: "collab.repoConnect.errorNetwork",
  exists: "collab.repoConnect.errorExists",
  git: "collab.repoConnect.errorGeneric",
  "invalid-url": "collab.repoConnect.errorInvalidUrl",
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
  // manual 모드에서만 쓰는 주소 입력값(clone 모드에선 프로젝트 값이 이긴다).
  const [manualUrl, setManualUrl] = useState("");

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

  // 프로젝트가 바뀌면 이전 에러/위치 선택/입력값을 비운다.
  useEffect(() => {
    setErrorKey(null);
    setErrorDetail(null);
    setParentDir(null);
    setManualUrl("");
  }, [currentProject?.id]);

  if (!visible || !currentProject) return null;

  const connectMode = repoConnectMode(currentProject);
  // clone 모드에선 프로젝트 값, manual 모드에선 사용자가 입력한 값.
  const repoUrl =
    connectMode === "clone"
      ? currentProject.gitRemoteUrl!.trim()
      : manualUrl.trim();
  const projectId = currentProject.id;
  const effectiveParent = parentDir ?? defaultParent;
  const destPreview =
    effectiveParent && repoUrl
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

  /**
   * manual 모드에서 확인된 주소를 프로젝트에 기록한다(fail-soft).
   * 이걸 해야 이 팀의 **다음** 멤버는 수동입력 없이 clone 모드로 받는다.
   * clone 모드(이미 주소를 아는 프로젝트)에서는 아무것도 덮지 않는다.
   */
  const backfillRepoUrl = async (url: string) => {
    if (connectMode !== "manual" || !url) return;
    try {
      await useProjectStore.getState().updateProject(projectId, {
        gitRemoteUrl: url,
      });
    } catch (err) {
      // 기록 실패가 연결을 막아선 안 된다 — 이 기기는 이미 연결된 상태다.
      console.error("Failed to backfill project gitRemoteUrl:", err);
    }
  };

  const handleClone = async () => {
    if (!repoUrl) return;
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
        await backfillRepoUrl(repoUrl);
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
      // 대조 상대가 있을 때만 대조한다. manual 모드에서 주소를 아직 안 적었
      // 다면 방금 고른 폴더의 origin 이 곧 이 프로젝트의 저장소다 — 그걸
      // 프로젝트에 기록해 다음 멤버부터 clone 모드가 되게 한다.
      if (
        repoUrl &&
        normalizeGitRemoteUrl(origin) !== normalizeGitRemoteUrl(repoUrl)
      ) {
        fail("collab.repoConnect.errorMismatch", origin);
        return;
      }
      await backfillRepoUrl(origin);
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
            {t(
              connectMode === "manual"
                ? "collab.repoConnect.manualDescription"
                : "collab.repoConnect.description",
            )}
          </p>

          <div>
            <div className="mb-1 text-xs font-medium text-gray-400">
              {t("collab.repoConnect.repoLabel")}
            </div>
            {connectMode === "manual" ? (
              <input
                type="text"
                value={manualUrl}
                onChange={(e) => setManualUrl(e.target.value)}
                disabled={busy}
                spellCheck={false}
                autoFocus
                placeholder={t("collab.repoConnect.urlPlaceholder")}
                className="w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-gray-200 font-mono placeholder-gray-600 focus:border-blue-500 focus:outline-none disabled:opacity-50"
              />
            ) : (
              <div className="rounded bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-gray-200 font-mono break-all">
                {repoUrl}
              </div>
            )}
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
                disabled={busy || !repoUrl}
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
