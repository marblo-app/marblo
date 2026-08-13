import { useEffect, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import { useProjectStore } from "../../stores/projectStore";
import { useEditorStore } from "../../stores/editorStore";
import { useAuth } from "../../hooks/useAuth";
import { normalizeGitRemoteUrl } from "../../services/projectService";
import {
  shouldOfferRepoConnect,
  resolveRepoConnectVisible,
  repoConnectMode,
  repoDirNameFromUrl,
  type OwnValidity,
} from "../../lib/repoConnect";
import telemetry from "../../services/telemetryService";
import type { MessageKey } from "../../locales/ko";

/**
 * 저장소 연결 모달 (티켓 r8VggohxLGciDVXV2rf6,
 * 게이트 완화 r8vIviEcwHFbFJ88RqZ7, own-but-empty 보강 r8vg9pMWCRtdnUzR3KyX).
 *
 * 초대 수락한 멤버가 프로젝트에 진입했는데 이 기기에 rootPath 가 없으면
 * project.gitRemoteUrl 을 보여주고 [Clone & 연결] 원클릭을 제공한다.
 * ★완전 자동풀 아님 — clone 은 반드시 이 모달의 명시적 버튼으로만 실행된다.
 *
 * 노출 판정은 shouldOfferRepoConnect(순수 함수)가 담당한다: 이미 연결된
 * 멤버(resolution kind === "own")나 machineId 미도착 시점에는 절대 뜨지
 * 않아 기존 화면이 픽셀 단위로 불변이다. 단, own 으로 표시된 폴더가
 * 비어 있거나 프로젝트와 다른 git 을 가리키면 예외적으로 다시 띄운다 —
 * 빈 폴더 자동 등록으로 영구히 코드 탭에 못 들어오던 갭을 막는다.
 *
 * 두 모드 (티켓 r8vIviEcwHFbFJ88RqZ7):
 *  - `clone`  — 프로젝트가 repo 주소를 안다. 기존 동작 그대로.
 *  - `manual` — 주소를 모른다(owner 가 한 번도 로컬 git 폴더를 안 붙인
 *    프로젝트). 예전엔 이 경우 모달이 아예 안 떠서 멤버가 코드에 손도 못
 *    댔다. 이제 주소 입력란을 띄우고, [기존 폴더 연결]은 고른 폴더의 origin
 *    을 그대로 채택한다. 어느 쪽이든 확인된 주소를 프로젝트에 backfill 해
 *    다음 멤버부터는 clone 모드가 된다.
 *
 * ★수동 재호출 (티켓 r8vg9pMWCRtdnUzR3KyX):
 * `window.dispatchEvent(new CustomEvent("marblo:open-repo-connect"))` 로
 * dismissed 상태를 리셋해 모달을 띄울 수 있다. 모달을 닫았거나 빈 폴더
 * 자동 등록으로 own 인 사용자가 설정/프로젝트 메뉴에서 수동으로 다시
 * 들어올 때 쓴다.
 */

/** clone 실패 종류 → 안내 문구 키. */
const ERROR_KEY: Record<string, MessageKey> = {
  auth: "collab.repoConnect.errorAuth",
  "not-found": "collab.repoConnect.errorNotFound",
  network: "collab.repoConnect.errorNetwork",
  exists: "collab.repoConnect.errorExists",
  git: "collab.repoConnect.errorGeneric",
  "invalid-url": "collab.repoConnect.errorInvalidUrl",
  // macOS Xcode CLT (티켓 nETj7szjEtT5prbYsg1D) — raw git 에러 대신 안내.
  "xcode-license": "collab.repoConnect.errorXcodeLicense",
  "xcode-missing": "collab.repoConnect.errorXcodeMissing",
};

/** CLT 사전 감지 결과의 issue → 안내 문구 키. */
const XCODE_ISSUE_KEY: Record<string, MessageKey> = {
  "license-not-agreed": "collab.repoConnect.errorXcodeLicense",
  "clt-missing": "collab.repoConnect.errorXcodeMissing",
};

/** 수동 재호출 진입점에서 보낼 커스텀 이벤트. */
export const REPO_CONNECT_OPEN_EVENT = "marblo:open-repo-connect";

/**
 * "터미널에 이 명령을 붙여넣으세요" 한 줄 + 복사 버튼.
 * 명령 원문은 항상 화면에 보이므로 클립보드가 막혀도 사용자가 직접 선택해
 * 복사할 수 있다 (티켓 nETj7szjEtT5prbYsg1D).
 */
function CommandRow({
  command,
  copied,
  onCopy,
  copyLabel,
  copiedLabel,
}: {
  command: string;
  copied: boolean;
  onCopy: () => void;
  copyLabel: string;
  copiedLabel: string;
}) {
  return (
    <div className="mt-2 flex items-center gap-2">
      <code className="flex-1 select-all rounded bg-gray-900 px-2 py-1 font-mono text-xs text-gray-200 break-all">
        {command}
      </code>
      <button
        type="button"
        onClick={onCopy}
        className="shrink-0 rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700"
      >
        {copied ? copiedLabel : copyLabel}
      </button>
    </div>
  );
}

export function RepoConnectModal() {
  const { t } = useTranslation();
  const { user } = useAuth();
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
  // 에러와 함께 보여줄 "터미널에 붙여넣을 명령"(현재는 Xcode CLT 안내 전용).
  const [fixCommand, setFixCommand] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // 사전 감지 결과 — 사용자가 [Clone & 연결] 을 누르기 전에 띄우는 배너.
  const [xcodeIssue, setXcodeIssue] = useState<XcodeCltStatus | null>(null);
  const [parentDir, setParentDir] = useState<string | null>(null);
  const [defaultParent, setDefaultParent] = useState<string | null>(null);
  // manual 모드에서만 쓰는 주소 입력값(clone 모드에선 프로젝트 값이 이긴다).
  const [manualUrl, setManualUrl] = useState("");
  const [githubConnected, setGithubConnected] = useState(false);
  const [githubMessage, setGithubMessage] = useState<string | null>(null);
  const [deviceSession, setDeviceSession] = useState<{
    sessionId: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete?: string;
    intervalSeconds: number;
  } | null>(null);

  // own 폴더의 실제 상태(빈 폴더/원격 불일치/정상). own 이 아닐 땐 의미 없음.
  // ★null = 검사 전/실패 — shouldOfferRepoConnect 가 "own 이면 표시 안 함"
  // 기존 동작을 유지하므로 부팅 시 깜빡임이 없다.
  const [ownValidity, setOwnValidity] = useState<OwnValidity>(null);

  // 수동 재호출 플래그. dismissed 와 무관하게 모달을 띄운다. 라운드 종료
  // 시(모달이 닫히거나 다시 정상 own 이 되면) 자동 해제된다.
  const [forceOpen, setForceOpen] = useState(false);

  // 수동 재호출 이벤트 리스너.
  useEffect(() => {
    const handler = () => setForceOpen(true);
    window.addEventListener(REPO_CONNECT_OPEN_EVENT, handler);
    return () => window.removeEventListener(REPO_CONNECT_OPEN_EVENT, handler);
  }, []);

  // kind === "own" 일 때만 폴더 상태를 한 번 검사한다. foreign-only /
  // unregistered 는 어차피 모달이 떠야 하니 검사할 이유가 없다.
  useEffect(() => {
    const kind = currentProject?.folderPathResolution?.kind;
    if (kind !== "own" || !currentProject) {
      setOwnValidity(null);
      return;
    }
    const resolution = currentProject.folderPathResolution;
    if (!resolution || resolution.kind !== "own") {
      setOwnValidity(null);
      return;
    }
    const ownPath = resolution.path;
    if (!ownPath) {
      setOwnValidity(null);
      return;
    }
    let cancelled = false;
    setOwnValidity(null); // 새 검사 시작 — 깜빡임 방지로 일단 null
    window.electronAPI.fs
      ?.checkFolderValidity?.({
        folderPath: ownPath,
        expectedRemoteUrl: currentProject.gitRemoteUrl ?? null,
      })
      .then((result) => {
        if (cancelled || !result) return;
        if (!result.exists) {
          // 폴더가 사라졌다 — 사용자가 정리한 케이스. 빈 폴더로 간주.
          setOwnValidity("empty");
          return;
        }
        if (result.isEmpty) {
          setOwnValidity("empty");
          return;
        }
        if (result.remoteUrl && result.matches === false) {
          setOwnValidity("mismatch");
          return;
        }
        // origin 이 같거나 비교 상대가 없을 때(프로젝트에 URL 없음)는 valid.
        setOwnValidity("valid");
      })
      .catch(() => {
        // IPC 실패 — 기존 동작 유지.
        if (!cancelled) setOwnValidity(null);
      });
    return () => {
      cancelled = true;
    };
  }, [
    currentProject?.id,
    currentProject?.folderPathResolution,
    currentProject?.gitRemoteUrl,
  ]);

  const isOwn = currentProject?.folderPathResolution?.kind === "own";
  const offered = shouldOfferRepoConnect(
    currentProject,
    machineId,
    ownValidity,
  );
  const visible =
    resolveRepoConnectVisible(offered, forceOpen) &&
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

  // ★사전 감지 (티켓 nETj7szjEtT5prbYsg1D). macOS 에서 Xcode CLT 라이선스에
  // 동의하지 않았거나 CLT 가 없으면 git 이 아예 안 돌아 clone 이 100% 실패한다.
  // 사용자가 버튼을 누르고 실패를 맞기 전에 모달 상단에서 먼저 알려준다.
  // 실패(구버전 main·IPC 없음)는 조용히 무시 — 그 경우 clone 결과의
  // errorKind 가 같은 안내를 띄운다.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    window.electronAPI.system
      ?.xcodeClt?.()
      .then((status) => {
        if (cancelled) return;
        setXcodeIssue(status && !status.ok ? status : null);
      })
      .catch(() => {
        if (!cancelled) setXcodeIssue(null);
      });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  useEffect(() => {
    if (!user?.uid) {
      setGithubConnected(false);
      return;
    }
    let cancelled = false;
    window.electronAPI.github
      .status(user.uid)
      .then(({ connected }) => {
        if (!cancelled) setGithubConnected(connected);
      })
      .catch(() => {
        if (!cancelled) setGithubConnected(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.uid, visible]);

  useEffect(() => {
    if (!deviceSession) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      window.electronAPI.github
        .devicePoll(deviceSession.sessionId)
        .then((result) => {
          if (cancelled) return;
          if (result.kind === "pending" || result.kind === "slow_down") {
            setDeviceSession({
              ...deviceSession,
              intervalSeconds:
                result.nextIntervalSeconds ?? deviceSession.intervalSeconds,
            });
            return;
          }
          setDeviceSession(null);
          if (result.kind === "success") {
            setGithubConnected(true);
            setGithubMessage(
              "GitHub가 연결되었습니다. 이제 private 저장소를 clone할 수 있습니다.",
            );
          } else if (result.kind === "denied") {
            setGithubMessage("GitHub 연결이 취소되었습니다.");
          } else if (result.kind === "expired") {
            setGithubMessage(
              "GitHub 연결 코드가 만료되었습니다. 다시 시도하세요.",
            );
          } else {
            setGithubMessage(result.message ?? "GitHub 연결에 실패했습니다.");
          }
        })
        .catch(() => {
          if (!cancelled) {
            setDeviceSession(null);
            setGithubMessage("GitHub 연결에 실패했습니다.");
          }
        });
    }, deviceSession.intervalSeconds * 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [deviceSession]);

  // 프로젝트가 바뀌면 이전 에러/위치 선택/입력값을 비운다. forceOpen 도
  // 새 프로젝트에 대해 다시 신호를 줘야 하므로 유지한다 — 단 visible 이
  // false 가 되면 다음 effect 에서 정리된다.
  useEffect(() => {
    setErrorKey(null);
    setErrorDetail(null);
    setFixCommand(null);
    setCopied(false);
    setParentDir(null);
    setManualUrl("");
  }, [currentProject?.id]);

  // 모달이 보이지 않게 되는 순간 forceOpen 을 풀어 다음 자동 게이트가 깨끗
  // 하게 시작되게 한다(수동 신호는 한 번 쓰고 버림).
  useEffect(() => {
    if (!visible) setForceOpen(false);
  }, [visible]);

  if (!visible || !currentProject) return null;

  const connectMode = repoConnectMode(currentProject);
  // own-empty/mismatch 케이스에서 보여줄 자기 진단. valid 면 표시 안 함.
  const ownIssue =
    isOwn && ownValidity === "empty"
      ? "empty"
      : isOwn && ownValidity === "mismatch"
        ? "mismatch"
        : null;
  const ownPath =
    currentProject.folderPathResolution &&
    currentProject.folderPathResolution.kind === "own"
      ? currentProject.folderPathResolution.path
      : "";
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

  const fail = (
    key: MessageKey,
    detail?: string | null,
    command?: string | null,
  ) => {
    setErrorKey(key);
    setErrorDetail(detail ?? null);
    setFixCommand(command ?? null);
    setCopied(false);
  };

  /** 안내 명령을 클립보드로. 실패해도 명령 원문은 화면에 그대로 남는다. */
  const copyFixCommand = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* 클립보드 거부 — 사용자가 직접 선택해 복사할 수 있다 */
    }
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
    setFixCommand(null);
    setCopied(false);
    try {
      const result = await window.electronAPI.repo.clone({
        projectId,
        repoUrl,
        parentDir: effectiveParent,
        userId: user?.uid,
      });
      if (result.ok && result.path) {
        await backfillRepoUrl(repoUrl);
        await connectPath(result.path, "member-clone");
      } else {
        const isXcode =
          result.errorKind === "xcode-license" ||
          result.errorKind === "xcode-missing";
        fail(
          ERROR_KEY[result.errorKind ?? "git"] ??
            "collab.repoConnect.errorGeneric",
          // Xcode 안내는 문구 자체가 완결이라 stderr 요약을 덧붙이면 오히려
          // 원문 에러를 다시 노출하는 꼴이 된다 — 명령만 붙인다.
          isXcode ? null : result.message,
          result.fixCommand,
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
    setFixCommand(null);
    setCopied(false);
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

  const handleGitHubConnect = async () => {
    if (!user?.uid) return;
    setGithubMessage(null);
    const result = await window.electronAPI.github.deviceStart(user.uid);
    if (
      !result.ok ||
      !result.sessionId ||
      !result.userCode ||
      !result.verificationUri ||
      !result.interval
    ) {
      setGithubMessage(result.error ?? "GitHub 연결을 시작하지 못했습니다.");
      return;
    }
    setDeviceSession({
      sessionId: result.sessionId,
      userCode: result.userCode,
      verificationUri: result.verificationUri,
      verificationUriComplete: result.verificationUriComplete,
      intervalSeconds: result.interval,
    });
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
            {ownIssue
              ? t(`collab.repoConnect.ownIssue.${ownIssue}`, { path: ownPath })
              : t(
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
              {fixCommand && (
                <CommandRow
                  command={fixCommand}
                  copied={copied}
                  onCopy={() => void copyFixCommand(fixCommand)}
                  copyLabel={t("collab.repoConnect.copyCommand")}
                  copiedLabel={t("collab.repoConnect.copied")}
                />
              )}
            </div>
          )}

          {/* 사전 감지 배너 — 아직 아무 버튼도 누르지 않았지만 이대로면
              반드시 실패한다. 실패한 에러 박스가 이미 같은 안내를 띄우고
              있으면 중복을 피해 숨긴다. */}
          {xcodeIssue?.issue &&
            !fixCommand &&
            (() => {
              const command = xcodeIssue.command;
              return (
                <div className="rounded bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-sm text-amber-300">
                  <div>
                    {t(
                      XCODE_ISSUE_KEY[xcodeIssue.issue] ??
                        "collab.repoConnect.errorXcodeLicense",
                    )}
                  </div>
                  {command && (
                    <CommandRow
                      command={command}
                      copied={copied}
                      onCopy={() => void copyFixCommand(command)}
                      copyLabel={t("collab.repoConnect.copyCommand")}
                      copiedLabel={t("collab.repoConnect.copied")}
                    />
                  )}
                </div>
              );
            })()}

          <p className="text-xs text-gray-500">
            {t("collab.repoConnect.privateHint")}
          </p>

          <div className="rounded border border-gray-700 bg-gray-900/60 px-3 py-3 text-sm text-gray-300">
            {githubConnected ? (
              <span className="text-green-400">GitHub 연결됨</span>
            ) : deviceSession ? (
              <div className="space-y-2">
                <div>
                  GitHub에서 다음 코드를 입력하세요:{" "}
                  <strong className="font-mono text-white">
                    {deviceSession.userCode}
                  </strong>
                </div>
                <a
                  className="text-blue-400 hover:text-blue-300"
                  href={
                    deviceSession.verificationUriComplete ??
                    deviceSession.verificationUri
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  GitHub 열기
                </a>
              </div>
            ) : (
              <button
                onClick={() => void handleGitHubConnect()}
                disabled={busy || !user}
                className="text-blue-400 hover:text-blue-300 disabled:opacity-50"
              >
                GitHub 연결
              </button>
            )}
            {githubMessage && (
              <div className="mt-2 text-xs text-gray-400">{githubMessage}</div>
            )}
          </div>

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
