import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, RefreshCw } from "lucide-react";
import { useTranslation } from "../../lib/i18n";
import type { InvitationRole } from "../../types/invitation";
import {
  installJustCompleted,
  resolveGitHubAppGuide,
  type GitHubAppStatusView,
  type GuideTone,
} from "../../lib/githubAppGuide";
import { REPO_CONNECT_OPEN_EVENT } from "./RepoConnectModal";

/**
 * GitHubAccessGuide — "이 프로젝트에서 GitHub 코드를 주고받으려면 무엇이
 * 필요한가" 를 **앱 안에서** 읽게 해 주는 화면 (티켓 kzxsRzC37uVvYftpVZO4).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ★한 컴포넌트, 두 개의 화면 — 두 사람이 서로 다른 것을 하기 때문이다
 * ─────────────────────────────────────────────────────────────────────────
 *   오너  GitHub 에서 App 설치(한 번)  →  보드에서 역할 부여
 *   팀원  앱에 자기 GitHub 로 로그인   →  끝. **GitHub 에서 할 게 없다.**
 *
 * 팀원 화면의 머리글은 상태와 무관하게 항상 "GitHub 에서 하실 일은 없습니다"
 * + "초대 메일을 기다리지 마세요" 다. 이 기능의 가장 흔한 실패는 크래시가
 * 아니라 **팀원이 GitHub 을 열어 뭔가 찾다가 포기하는 것**이라서, 그 말을
 * 실패 상태에서도 계속 보이게 둔다.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ★실패 상태를 반드시 그린다
 * ─────────────────────────────────────────────────────────────────────────
 * UX 감사가 "로딩 40개 중 28개가 실패 상태를 안 그린다" 고 했다. 이 화면은
 * 그러면 안 된다 — 판정은 `resolveGitHubAppGuide`(순수 함수)가 하고, 그
 * 타입이 **모든 상태에 `nextActionKey` 를 강제**한다. "다음에 뭘 하면
 * 되는지" 가 없는 상태는 타입상 만들 수 없다.
 *
 * ★조회 실패를 로딩으로 위장하지 않는다: `status===null`(아직 안 옴)과
 * `failed`(실패)를 다른 값으로 들고 있다. 하나로 뭉개면 실패가 영원히 도는
 * 스피너로 보인다.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ★경계
 * ─────────────────────────────────────────────────────────────────────────
 *  - App slug 를 **하드코딩하지 않는다.** 설치 URL 은 서버가 서명된 state 를
 *    붙여 만들어 주고(`startGitHubAppInstall`), 렌더러는 여는 것도 하지
 *    않는다 — main 이 시스템 브라우저로 연다.
 *  - device OAuth 로그인 흐름은 **건드리지 않는다.** 이미 동작한다. 팀원
 *    문구가 그 화면(설정 → 연결)을 가리키기만 한다.
 *  - 문구는 권한 상태를 **과장하지 않는다**. `writeGranted` 가 거짓인 구간은
 *    "받는 건 됩니다 / 미는 건 아직" 이라고 정확히 말한다.
 */

/** 상태 → 뱃지·테두리 색. 판정은 순수 함수가 끝냈고 여기선 색만 고른다. */
const TONE_STYLES: Record<
  GuideTone,
  { badge: string; card: string; labelKey: Parameters<TFn>[0] }
> = {
  ok: {
    badge: "bg-green-500/20 text-green-300 border-green-500/30",
    card: "border-green-500/30 bg-green-500/5",
    labelKey: "githubGuide.badge.ok",
  },
  warn: {
    badge: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    card: "border-amber-500/30 bg-amber-500/5",
    labelKey: "githubGuide.badge.warn",
  },
  blocked: {
    badge: "bg-red-500/20 text-red-300 border-red-500/30",
    card: "border-red-500/30 bg-red-500/5",
    labelKey: "githubGuide.badge.blocked",
  },
  neutral: {
    badge: "bg-gray-600/30 text-gray-300 border-gray-600/40",
    card: "border-gray-700 bg-gray-800/40",
    labelKey: "githubGuide.badge.neutral",
  },
};

type TFn = ReturnType<typeof useTranslation>["t"];

/** 이 빌드에 App 상태 IPC 가 있는가. 브라우저에서 띄운 렌더러에는 없다. */
function githubApi(): GitHubAPI | null {
  return window.electronAPI?.github ?? null;
}

export interface GitHubAccessGuideProps {
  projectId: string;
  /** 내가 이 프로젝트의 오너인가 — 화면의 갈래를 정하는 축. */
  isOwner: boolean;
  /** 마블로 역할(Firestore 진실원). */
  role: InvitationRole;
  /** 프로젝트에 저장소 주소가 등록돼 있는가. */
  hasRepoUrl: boolean;
  /**
   * App 경로가 실제로 살아 있는가(설치됨 + 이 저장소를 열 수 있음)를 부모에게
   * 알린다. ★같은 화면에 있는 **레거시 콜라보레이터 안내와 모순되지 않게**
   * 하려고 있다 — App 이 붙어 있으면 "GitHub 콜라보레이터로도 추가하세요" 는
   * 틀린 말이 되고, 그 모순이 곧 이 티켓이 없애려는 혼란이다.
   * 아직 모를 때(조회 전·실패)는 호출되지 않는다.
   */
  onAppConnectedChange?: (connected: boolean) => void;
}

export function GitHubAccessGuide({
  projectId,
  isOwner,
  role,
  hasRepoUrl,
  onAppConnectedChange,
}: GitHubAccessGuideProps) {
  const { t } = useTranslation();

  const [status, setStatus] = useState<GitHubAppStatusView | null>(null);
  const [failed, setFailed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  /** 방금 설치가 확인됐다 — 오너가 GitHub 을 다시 열어보지 않아도 되게. */
  const [justInstalled, setJustInstalled] = useState(false);

  const supported = typeof githubApi()?.appStatus === "function";

  // 직전 상태를 ref 로 들고 "방금 됐다" 를 판정한다. state 로 비교하면
  // setStatus 이후의 렌더에서 이전 값을 잃는다.
  const previous = useRef<GitHubAppStatusView | null>(null);

  const check = useCallback(
    async (opts: { announce: boolean }) => {
      const api = githubApi();
      if (!projectId || !api?.appStatus) return;
      setChecking(true);
      try {
        const next = await api.appStatus(projectId);
        // ★"됐다" 는 설치 여부만이 아니라 **저장소를 열 수 있는지**까지 본다.
        // 설치는 했는데 저장소를 안 고른 경우를 완료라고 말하면 그게 과장이다.
        if (opts.announce && installJustCompleted(previous.current, next)) {
          setJustInstalled(true);
        }
        previous.current = next;
        setStatus(next);
        setFailed(false);
        onAppConnectedChange?.(next.installed && next.repoAccessible);
      } catch {
        // ★확인하지 못한 것을 "연결됨" 으로 위장하지 않는다. 실패는 실패로
        // 그리고, 사용자에게 [다시 확인] 을 준다.
        setFailed(true);
      } finally {
        setChecking(false);
      }
    },
    [projectId, onAppConnectedChange],
  );

  useEffect(() => {
    previous.current = null;
    setStatus(null);
    setFailed(false);
    setJustInstalled(false);
    void check({ announce: false });
  }, [check]);

  /**
   * ★설치하고 돌아왔을 때 "됐다" 를 앱이 확인해서 보여 준다.
   *
   * 설치는 시스템 브라우저에서 일어나고 앱 창은 그대로 남는다. 돌아온 순간
   * 다시 조회하지 않으면 오너는 자기가 설치했는지 확인하려고 GitHub 을 또
   * 열어야 한다. 포커스 복귀가 그 신호다.
   *
   * 오너에게만 건다 — 팀원 화면에는 설치 버튼이 없어서 창을 옮겼다 돌아올
   * 이유가 없고, 탭을 옮길 때마다 조회하면 불필요한 왕복이 된다.
   */
  useEffect(() => {
    if (!isOwner || !supported) return;
    const onFocus = () => void check({ announce: true });
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [isOwner, supported, check]);

  const startInstall = useCallback(async () => {
    const api = githubApi();
    if (!api?.appInstall || installing) return;
    setInstalling(true);
    setInstallError(null);
    try {
      // ★slug 도 URL 도 여기서 만들지 않는다. 서버가 서명된 state 를 붙여
      // 만들고, main 이 시스템 브라우저로 연다.
      const result = await api.appInstall(projectId);
      if (!result.ok) {
        setInstallError(result.error ?? t("githubGuide.error.title"));
      }
    } catch {
      setInstallError(t("githubGuide.error.title"));
    } finally {
      setInstalling(false);
    }
  }, [installing, projectId, t]);

  const state = resolveGitHubAppGuide({
    status,
    supported,
    failed,
    isOwner,
    role,
    hasRepoUrl,
  });
  const tone = TONE_STYLES[state.tone];

  return (
    <section
      className="rounded-lg border border-gray-700 bg-gray-800 p-4"
      aria-labelledby="github-access-guide-title"
    >
      <div className="mb-3">
        <h3
          id="github-access-guide-title"
          className="text-sm font-medium text-gray-200"
        >
          {isOwner
            ? t("githubGuide.owner.title")
            : t("githubGuide.member.title")}
        </h3>
        <p className="mt-0.5 text-xs text-gray-500">
          {isOwner
            ? t("githubGuide.owner.subtitle")
            : t("githubGuide.member.subtitle")}
        </p>
      </div>

      {isOwner ? (
        <OwnerSteps t={t} />
      ) : (
        <MemberNoInviteNotice t={t} role={role} />
      )}

      {/* ★상태를 먼저, 버튼은 그 다음. "설치하세요" 만 있고 지금 설치됐는지
          모르면 오너가 매번 GitHub 을 열어 확인해야 한다. */}
      <div className={`mt-3 rounded border p-3 ${tone.card}`}>
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-gray-500">
            {t("githubGuide.owner.statusLabel")}
          </span>
          <span
            className={`rounded border px-2 py-0.5 text-[11px] ${tone.badge}`}
          >
            {t(tone.labelKey)}
          </span>
          {checking && (
            <span className="text-[11px] text-gray-500">
              {t("githubGuide.owner.checking")}
            </span>
          )}
        </div>

        <p className="text-sm font-medium text-gray-100">{t(state.titleKey)}</p>
        <p className="mt-1 text-xs leading-relaxed text-gray-400">
          {t(state.bodyKey)}
        </p>

        {/* ★모든 상태에 "다음에 뭘 하면 되는지" 가 붙는다. 타입이 강제하므로
            여기서 조건부로 감출 수 없다 — 없으면 그냥 에러 화면이다. */}
        <div className="mt-2.5 rounded border border-gray-700/70 bg-gray-900/40 p-2.5">
          <p className="text-[11px] uppercase tracking-wide text-gray-500">
            {t("githubGuide.nextLabel")}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-gray-200">
            {t(state.nextActionKey)}
          </p>
          {/* 서버가 사유를 뭉개는 상태에서만 갈래를 덧붙인다 — 단정하지 않는다. */}
          {state.alsoKey && (
            <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
              {t(state.alsoKey)}
            </p>
          )}
        </div>

        {justInstalled && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-green-300">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{t("githubGuide.owner.installConfirmed")}</span>
          </p>
        )}

        {installError && (
          <p role="alert" className="mt-2 text-xs text-red-300">
            {t("githubGuide.owner.installFailed", { error: installError })}
          </p>
        )}

        <GuideActions
          t={t}
          action={state.action}
          checking={checking}
          installing={installing}
          supported={supported}
          onInstall={() => void startInstall()}
          onRecheck={() => void check({ announce: true })}
        />
      </div>

      {isOwner && <OwnerPermissionNote t={t} />}
    </section>
  );
}

/** 오너가 하는 두 가지. ★GitHub 콜라보레이터 초대가 아니라는 걸 못박는다. */
function OwnerSteps({ t }: { t: TFn }) {
  return (
    <div className="rounded border border-gray-700 bg-gray-900/40 p-3">
      <p className="text-xs font-medium text-gray-300">
        {t("githubGuide.owner.stepsTitle")}
      </p>
      <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-xs text-gray-400">
        <li>{t("githubGuide.owner.step1")}</li>
        <li>{t("githubGuide.owner.step2")}</li>
      </ol>
      <p className="mt-1.5 text-xs text-gray-500">
        {t("githubGuide.owner.stepNote")}
      </p>
    </div>
  );
}

/**
 * ★팀원 화면의 핵심. 상태와 무관하게 항상 보인다 — "초대 메일을 기다리지
 * 마라"(안 온다) + "GitHub 에서 할 게 없다".
 */
function MemberNoInviteNotice({ t, role }: { t: TFn; role: InvitationRole }) {
  return (
    <div className="rounded border border-blue-500/30 bg-blue-500/5 p-3">
      <p className="text-xs font-medium text-blue-200">
        {t("githubGuide.member.noInviteTitle")}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-gray-400">
        {t("githubGuide.member.noInviteBody")}
      </p>
      <p className="mt-1.5 text-xs text-gray-500">
        {t("githubGuide.member.loginCta")}
      </p>
      <p className="mt-1.5 text-[11px] uppercase tracking-wide text-gray-500">
        {t("githubGuide.roleLabel")}: {role}
      </p>
    </div>
  );
}

/** ★권한을 왜 요구하는지 한 줄 + 설치 범위 경고. */
function OwnerPermissionNote({ t }: { t: TFn }) {
  return (
    <div className="mt-3 rounded border border-gray-700 bg-gray-900/40 p-3">
      <p className="text-xs font-medium text-gray-300">
        {t("githubGuide.owner.whyPermission")}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-gray-400">
        {t("githubGuide.owner.whyPermissionBody")}
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-amber-300/80">
        {t("githubGuide.owner.scopeHint")}
      </p>
    </div>
  );
}

/**
 * 상태가 요구하는 행동 버튼.
 *
 * ★`install` 은 오너 상태에서만 나온다(순수 함수가 그렇게 판정한다) — 서버가
 * 오너만 설치 URL 을 내주므로, 팀원에게 설치 버튼을 보여 주면 눌러도
 * permission-denied 로 끝나는 가짜 버튼이 된다.
 */
function GuideActions({
  t,
  action,
  checking,
  installing,
  supported,
  onInstall,
  onRecheck,
}: {
  t: TFn;
  action: ReturnType<typeof resolveGitHubAppGuide>["action"];
  checking: boolean;
  installing: boolean;
  supported: boolean;
  onInstall: () => void;
  onRecheck: () => void;
}) {
  if (action === "none" && !supported) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {action === "install" && (
        <button
          type="button"
          onClick={onInstall}
          disabled={installing}
          className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          {installing
            ? t("githubGuide.owner.installOpening")
            : t("githubGuide.owner.installCta")}
        </button>
      )}

      {action === "repo-connect" && (
        <button
          type="button"
          onClick={() =>
            window.dispatchEvent(new CustomEvent(REPO_CONNECT_OPEN_EVENT))
          }
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500"
        >
          {t("collab.repoConnect.title")}
        </button>
      )}

      {supported && (
        <button
          type="button"
          onClick={onRecheck}
          disabled={checking}
          className="inline-flex items-center gap-1.5 rounded border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-200 transition-colors hover:border-gray-500 hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`}
            aria-hidden
          />
          {t("githubGuide.owner.recheckCta")}
        </button>
      )}

      {action === "install" && (
        <span className="text-[11px] text-gray-500">
          {t("githubGuide.owner.returnHint")}
        </span>
      )}
    </div>
  );
}
