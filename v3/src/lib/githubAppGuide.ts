import type { MessageKey } from "../locales/ko";
import type { InvitationRole } from "../types/invitation";

/**
 * githubAppGuide — "이 프로젝트에서 GitHub 코드를 주고받으려면 무엇이 필요한가"
 * 를 **화면에 그릴 수 있는 상태 하나**로 접는 순수 판정 (티켓 kzxsRzC37uVvYftpVZO4).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ★이 기능은 두 사람이 **서로 다른 것**을 한다 — 그래서 화면도 둘이다
 * ─────────────────────────────────────────────────────────────────────────
 *   오너  GitHub 에서 App 설치(한 번)  →  마블로 보드에서 역할 부여
 *   팀원  앱에 자기 GitHub 로 로그인   →  끝. **GitHub 에서 할 게 없다.**
 *
 * 이 기능의 가장 흔한 실패는 크래시가 아니라 **팀원이 "나도 GitHub 에서
 * 뭔가 해야 하나?" 로 헤매는 것**이다. 그래서 팀원 화면의 머리글은 상태와
 * 무관하게 항상 "당신이 GitHub 에서 할 일은 없다 + 초대 메일을 기다리지
 * 말라" 다. 아래 판정은 그 머리글 **밑에** 붙는 "지금 무엇이 막혀 있나" 다.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ★모든 상태에 `nextActionKey` 가 있다 — 없으면 그냥 에러 화면이다
 * ─────────────────────────────────────────────────────────────────────────
 * `nextActionKey` 는 옵셔널이 아니라 **필수 필드**다. 타입이 강제하므로 새
 * 상태를 추가하면서 "다음에 뭘 하면 되는지" 를 빼먹을 수 없고,
 * `MessageKey` 로 좁혀 뒀으므로 ko 에 없는 키를 쓰면 컴파일이 깨진다
 * (en 은 `Record<MessageKey, string>` 이라 en 누락도 같이 깨진다).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ★서버가 알려주지 않는 것 — 여기서 정직하게 다룬다
 * ─────────────────────────────────────────────────────────────────────────
 * `getGitHubAppStatus` 는 거부 사유를 **일부러** 뭉갠다. `evaluateInstallation
 * TokenRequest` 가 거부하면(not-a-member / no-team-entitlement /
 * no-installation / no-repo-url) 전부 `{installed:false, role:null,
 * configured:true}` 로 같은 모양이 되어 내려온다 — 사유를 정밀하게 알려주면
 * 남의 프로젝트 존재·설치 여부를 프로빙하는 도구가 되기 때문이다
 * (functions/src/githubApp.ts 의 `IssueDenyCode` 주석).
 *
 * 그래서 클라가 **이미 확실히 아는 사실**로 먼저 가른다:
 *   - 마블로 역할 → `useTeam().currentRole` (Firestore 구독, 권한의 진실원)
 *   - 저장소 주소 → `project.gitRemoteUrl`
 * 이 둘로 갈리지 않는 나머지에서만 콜러블의 `installed` 를 믿는다. 그러고도
 * 남는 모호함(오너 플랜에 팀 협업이 없어서 거부된 경우)은 **문구가 직접
 * 인정한다** — "오너가 설치했는데도 이 화면이 그대로면 플랜을 확인" 이 그
 * 상태의 보조 안내로 붙는다(`githubGuide.member.notInstalled.also`).
 * 추측으로 단정하지 않는다.
 */

/**
 * `github:appStatus` IPC 가 돌려주는 화면용 상태. ★토큰은 없다 — boolean 과
 * 역할뿐이다(설계 §5-B3).
 *
 * ★모르는 값은 전부 "못 한다" 로 접혀서 온다(electron/github-app-client.ts).
 * 구버전 서버(v1)를 상대해도 `writeGranted` 가 참으로 새지 않는다.
 */
export interface GitHubAppStatusView {
  /** 이 프로젝트에 App 설치가 바인딩돼 있는가(`githubInstallationId` 존재). */
  installed: boolean;
  /** 그 설치가 **지금도** 이 저장소를 열 수 있는가. */
  repoAccessible: boolean;
  /** 이 배포의 서버에 App 자격증명이 설정돼 있는가. 거짓이면 기능 자체가 없다. */
  configured: boolean;
  /** 요청자의 마블로 프로젝트 역할. 거부 시 null. */
  role: string | null;
  /** 역할이 push 를 허용하는가(viewer 는 영원히 false). */
  canWrite: boolean;
  /** 역할이 기본 브랜치 merge 를 허용하는가. */
  canMerge: boolean;
  /** 설치가 `contents:write` 를 **승인**했는가. 역할과는 별개 축이다. */
  writeGranted: boolean;
}

/** 상태 뱃지 색. 컴포넌트가 tone → 클래스로만 매핑한다. */
export type GuideTone = "ok" | "warn" | "blocked" | "neutral";

/**
 * 화면이 붙일 수 있는 행동. ★`install` 은 **오너 상태에서만** 나온다 —
 * 서버가 오너만 설치 URL 을 내주므로(startGitHubAppInstall), 팀원에게 설치
 * 버튼을 보여 주면 눌러도 permission-denied 로 끝나는 가짜 버튼이 된다.
 */
export type GuideAction = "install" | "repo-connect" | "refresh" | "none";

/** 판정 결과 한 덩어리. 컴포넌트는 이걸 그대로 그린다. */
export interface GitHubAppGuideState {
  kind: GuideKind;
  tone: GuideTone;
  titleKey: MessageKey;
  bodyKey: MessageKey;
  /** ★필수. "다음에 뭘 하면 되는지" — 이게 없으면 그냥 에러 화면이다. */
  nextActionKey: MessageKey;
  /**
   * 단정할 수 없는 갈래를 정직하게 덧붙이는 보조 문구. 서버가 사유를 뭉개서
   * 내려주는 상태에서만 쓴다.
   */
  alsoKey?: MessageKey;
  action: GuideAction;
}

export type GuideKind =
  // ── 공통 전제 ────────────────────────────────────────────────────────
  /** 아직 조회 전. */
  | "loading"
  /** 이 빌드에 IPC 가 없다(브라우저에서 띄운 렌더러 등). */
  | "unsupported"
  /** 조회가 실패했다. "접근 가능" 으로 위장하지 않는다. */
  | "error"
  /** 서버에 App 자격증명이 없다 = 이 배포엔 기능이 아직 없다. */
  | "not-configured"
  // ── 오너 ─────────────────────────────────────────────────────────────
  | "owner-no-repo-url"
  | "owner-not-installed"
  | "owner-repo-mismatch"
  | "owner-read-only"
  | "owner-ready"
  // ── 팀원 ─────────────────────────────────────────────────────────────
  | "member-no-repo-url"
  | "member-not-installed"
  | "member-repo-mismatch"
  | "member-read-only"
  | "member-viewer"
  | "member-ready";

export interface GuideInput {
  /**
   * 조회 결과. `null` 이면 아직 안 왔다는 뜻(loading) — 조회 실패는 `null`
   * 이 아니라 `failed: true` 로 구분한다. 둘을 같은 값으로 뭉개면 실패가
   * 영원한 로딩 스피너로 보인다(오늘 UX 감사가 지적한 그 실패다).
   */
  status: GitHubAppStatusView | null;
  /** IPC 자체가 없는 빌드인가. */
  supported: boolean;
  /** 조회가 예외로 끝났는가. */
  failed: boolean;
  /** 내가 이 프로젝트의 오너인가. 화면의 갈래를 정하는 축. */
  isOwner: boolean;
  /** 마블로 역할(Firestore 진실원). 콜러블이 뭉개는 사유를 여기서 가른다. */
  role: InvitationRole;
  /** 프로젝트에 저장소 주소가 등록돼 있는가. */
  hasRepoUrl: boolean;
}

/**
 * 상태 → 화면. 순서가 곧 "무엇을 먼저 고쳐야 하나" 다:
 *
 *  1. 조회 자체가 안 되는 전제(미지원·실패·미설정) — 그 위의 어떤 안내도
 *     의미가 없다.
 *  2. 저장소 주소 없음 — App 을 설치해도 붙일 저장소가 없다. 설치보다 앞이다.
 *  3. 설치 안 됨 → 저장소 불일치 → 권한(read 뿐) 순. GitHub 쪽이 뚫리는 순서.
 *  4. ★역할 게이트는 **맨 마지막**이다. 위가 다 뚫린 뒤에야 "그런데 당신
 *     역할로는 push 가 안 된다" 가 사용자에게 의미 있는 말이 된다. 앞에 두면
 *     오너가 App 도 안 깔았는데 팀원에게 "역할이 부족" 이라고 잘못 말한다.
 */
export function resolveGitHubAppGuide(input: GuideInput): GitHubAppGuideState {
  const { status, supported, failed, isOwner, role, hasRepoUrl } = input;

  if (!supported) {
    return {
      kind: "unsupported",
      tone: "neutral",
      titleKey: "githubGuide.unsupported.title",
      bodyKey: "githubGuide.unsupported.body",
      nextActionKey: "githubGuide.unsupported.next",
      action: "none",
    };
  }

  if (failed) {
    return {
      kind: "error",
      tone: "warn",
      titleKey: "githubGuide.error.title",
      bodyKey: "githubGuide.error.body",
      nextActionKey: "githubGuide.error.next",
      action: "refresh",
    };
  }

  if (!status) {
    return {
      kind: "loading",
      tone: "neutral",
      titleKey: "githubGuide.loading.title",
      bodyKey: "githubGuide.loading.body",
      nextActionKey: "githubGuide.loading.next",
      action: "none",
    };
  }

  // 서버에 App 자격증명이 없다. ★"미설정이 곧 이 기능이 아직 없음" 이고,
  // 그래서 슬러그를 클라가 알 이유가 없다 — 설치 URL 은 서버가 만들어 준다.
  if (!status.configured) {
    return {
      kind: "not-configured",
      tone: "neutral",
      titleKey: "githubGuide.notConfigured.title",
      bodyKey: "githubGuide.notConfigured.body",
      nextActionKey: isOwner
        ? "githubGuide.notConfigured.nextOwner"
        : "githubGuide.notConfigured.nextMember",
      action: "none",
    };
  }

  // 저장소 주소가 없으면 설치를 해도 붙일 대상이 없다. 설치 안내보다 앞이다.
  if (!hasRepoUrl) {
    return isOwner
      ? {
          kind: "owner-no-repo-url",
          tone: "blocked",
          titleKey: "githubGuide.owner.noRepoUrl.title",
          bodyKey: "githubGuide.owner.noRepoUrl.body",
          nextActionKey: "githubGuide.owner.noRepoUrl.next",
          action: "repo-connect",
        }
      : {
          kind: "member-no-repo-url",
          tone: "blocked",
          titleKey: "githubGuide.member.noRepoUrl.title",
          bodyKey: "githubGuide.member.noRepoUrl.body",
          nextActionKey: "githubGuide.member.noRepoUrl.next",
          action: "none",
        };
  }

  if (!status.installed) {
    return isOwner
      ? {
          kind: "owner-not-installed",
          tone: "blocked",
          titleKey: "githubGuide.owner.notInstalled.title",
          bodyKey: "githubGuide.owner.notInstalled.body",
          nextActionKey: "githubGuide.owner.notInstalled.next",
          action: "install",
        }
      : {
          kind: "member-not-installed",
          tone: "blocked",
          titleKey: "githubGuide.member.notInstalled.title",
          bodyKey: "githubGuide.member.notInstalled.body",
          nextActionKey: "githubGuide.member.notInstalled.next",
          // ★서버가 사유를 뭉갠다(설치 없음 / 오너 플랜에 팀 협업 없음 /
          // 멤버십 없음이 전부 같은 모양). 단정하지 않고 갈래를 알려준다.
          alsoKey: "githubGuide.member.notInstalled.also",
          action: "none",
        };
  }

  // 설치는 살아 있는데 이 저장소를 못 연다 = 오너가 저장소를 설치에 넣지
  // 않았거나, App 을 지웠거나, 저장소를 org 로 옮겼다(문서 §4).
  if (!status.repoAccessible) {
    return isOwner
      ? {
          kind: "owner-repo-mismatch",
          tone: "blocked",
          titleKey: "githubGuide.owner.repoMismatch.title",
          bodyKey: "githubGuide.owner.repoMismatch.body",
          nextActionKey: "githubGuide.owner.repoMismatch.next",
          action: "install",
        }
      : {
          kind: "member-repo-mismatch",
          tone: "blocked",
          titleKey: "githubGuide.member.repoMismatch.title",
          bodyKey: "githubGuide.member.repoMismatch.body",
          nextActionKey: "githubGuide.member.repoMismatch.next",
          action: "none",
        };
  }

  // ★여기부터 clone(read)은 **된다.** 아래 상태들은 전부 "받는 건 되는데
  // 미는 게 안 된다" 이고, 문구가 그걸 과장 없이 말해야 한다.
  if (!status.writeGranted) {
    return isOwner
      ? {
          kind: "owner-read-only",
          tone: "warn",
          titleKey: "githubGuide.owner.readOnly.title",
          bodyKey: "githubGuide.owner.readOnly.body",
          nextActionKey: "githubGuide.owner.readOnly.next",
          action: "install",
        }
      : {
          kind: "member-read-only",
          tone: "warn",
          titleKey: "githubGuide.member.readOnly.title",
          bodyKey: "githubGuide.member.readOnly.body",
          nextActionKey: "githubGuide.member.readOnly.next",
          action: "none",
        };
  }

  // ★역할 게이트는 맨 마지막. 설치·저장소·권한이 다 뚫린 뒤에야 "그런데
  // 당신 역할로는 못 민다" 가 정확한 말이 된다. viewer 는 clone 은 된다 —
  // 역할 게이트는 write 요청에만 걸린다(evaluateInstallationTokenRequest).
  if (!isOwner && role === "viewer") {
    return {
      kind: "member-viewer",
      tone: "warn",
      titleKey: "githubGuide.member.viewer.title",
      bodyKey: "githubGuide.member.viewer.body",
      nextActionKey: "githubGuide.member.viewer.next",
      action: "none",
    };
  }

  return isOwner
    ? {
        kind: "owner-ready",
        tone: "ok",
        titleKey: "githubGuide.owner.ready.title",
        bodyKey: "githubGuide.owner.ready.body",
        nextActionKey: "githubGuide.owner.ready.next",
        action: "none",
      }
    : {
        kind: "member-ready",
        tone: "ok",
        titleKey: "githubGuide.member.ready.title",
        bodyKey: "githubGuide.member.ready.body",
        nextActionKey: "githubGuide.member.ready.next",
        action: "none",
      };
}

/**
 * 설치가 **방금** 완료됐는가 — "설치하고 돌아왔을 때 됐다를 앱이 확인해서
 * 보여줘라" 의 판정부.
 *
 * 오너가 설치 버튼을 누르면 시스템 브라우저가 열리고 앱은 그대로 남는다.
 * 돌아왔을 때 앱이 스스로 다시 조회해서 `githubInstallationId` 가 생겼음을
 * **확인**해야 한다. 오너가 GitHub 을 다시 열어보게 만들면 안 된다.
 *
 * ★`installed` 만 보지 않고 `repoAccessible` 까지 본다. 설치는 했는데 저장소를
 * 안 고른 경우를 "완료" 라고 말하면 그게 곧 과장이다 — 그 경우는 위의
 * `*-repo-mismatch` 로 떨어져 저장소를 추가하라고 안내된다.
 */
export function installJustCompleted(
  before: GitHubAppStatusView | null,
  after: GitHubAppStatusView | null,
): boolean {
  if (!after) return false;
  if (!after.installed || !after.repoAccessible) return false;
  return !before || !before.installed || !before.repoAccessible;
}
