import { create } from "zustand";
import {
  PREVIEW_ENABLED_KEY,
  nextPreviewStage,
  previewBulk,
  type PreviewStage,
} from "../lib/onboardingPreview";
import type { BulkInstallProgress } from "../lib/oneClickSetup";
import type { CliModel } from "./cliSetupStore";

/**
 * 온보딩 프리뷰(개발/시연용)의 **부수효과 층** — 켜짐 여부와 시뮬 국면, 그리고
 * 국면을 스스로 굴리는 타이머. 판정 규칙은 전부 `lib/onboardingPreview` 에 있다.
 *
 * ★이 스토어가 손대지 않는 것: 실 프로브(`harness.cliAuthCheck`), 설치 IPC
 * (`harness.install`), PTY 스폰, 키체인, firestore, `cliSetupStore`. 프리뷰는
 * 비기너 온보딩 표면이 읽는 값을 갈아끼울 뿐이라(`hooks/useOnboardingSetup`),
 * 토글을 켠 상태로 앱이 죽어도 남는 건 localStorage 플래그 하나다.
 *
 * on/off 는 persist 한다 — 시연 중 앱 재시작(메인 프로세스 변경 반영 등)이
 * 흔한데 그때마다 토글을 다시 찾아 켜야 하면 시연이 끊긴다. 대신 프리뷰가 켜져
 * 있는 동안에는 화면 상단에 항상 개발용 배너가 서서, 켜 둔 사실을 잊을 수 없게
 * 한다(`components/beginner/OnboardingPreviewBanner`).
 */

/** 설치 한 줄당 시뮬 소요. 실제 셸 인스톨러보다 짧지만 진행이 보일 만큼은 준다. */
export const PREVIEW_INSTALL_STEP_MS = 900;
/** 로그인 터미널이 뜬 뒤 "브라우저 승인" 이 끝나기까지. */
export const PREVIEW_AUTH_MS = 3200;
/** 샘플 폴더 자동 연결(#872) 준비 시간. 모달 자동닫힘(1.6s)보다 길게 잡는다. */
export const PREVIEW_SAMPLE_MS = 2800;

function readEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PREVIEW_ENABLED_KEY) === "1";
  } catch {
    return false; // 프라이빗 모드 — 프리뷰는 꺼진 것으로 본다
  }
}

function persistEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) window.localStorage.setItem(PREVIEW_ENABLED_KEY, "1");
    else window.localStorage.removeItem(PREVIEW_ENABLED_KEY);
  } catch {
    /* 인메모리로 degrade — 이번 세션만 유지된다 */
  }
}

/**
 * 진행 중인 시뮬 타이머. 모듈 스코프인 이유는 끄기/다시시작이 **남은 전이를 전부**
 * 취소해야 하기 때문이다 — 하나라도 살아남으면 꺼 둔 프리뷰가 몇 초 뒤 스스로
 * 국면을 밀어 화면이 되살아난다.
 */
let timers: number[] = [];

function clearTimers(): void {
  for (const id of timers) {
    if (typeof window !== "undefined") window.clearTimeout(id);
  }
  timers = [];
}

function later(fn: () => void, ms: number): void {
  if (typeof window === "undefined") return;
  timers.push(window.setTimeout(fn, ms));
}

interface OnboardingPreviewState {
  enabled: boolean;
  stage: PreviewStage;
  /** 시뮬 일괄설치 진행(파생값 — `previewBulk` 이 만든다). */
  bulk: BulkInstallProgress | null;
  /** 지금 "로그인 터미널" 을 그리고 있는 CLI. */
  loginModel: CliModel | null;

  setEnabled: (enabled: boolean) => void;
  /** 처음(연결 게이트)부터 다시. 켜져 있는 상태에서 시연을 다시 돌릴 때. */
  restart: () => void;
  /** 시연자가 대기 시간을 건너뛴다. */
  advance: () => void;
  setStage: (stage: PreviewStage) => void;
  /** "모두 설치" 시뮬 — 행 수만큼 진행률을 굴리고 끝나면 사인인으로 넘어간다. */
  startInstallAll: (rowCount: number) => void;
  /** 자동 사인인 시뮬 — 터미널 대본을 띄우고 승인 대기 후 인증을 성립시킨다. */
  startSignIn: (model: CliModel) => void;
}

export const useOnboardingPreviewStore = create<OnboardingPreviewState>(
  (set, get) => {
    /** 인증 성립 → 샘플 연결 → 종료(패스스루). */
    const finishAuth = () => {
      set({ stage: "sample" });
      later(() => set({ stage: "done" }), PREVIEW_SAMPLE_MS);
    };

    return {
      enabled: readEnabled(),
      stage: "connect",
      bulk: null,
      loginModel: null,

      setEnabled: (enabled) => {
        clearTimers();
        persistEnabled(enabled);
        // 끌 때도 국면을 처음으로 되돌린다: 다시 켰을 때 "지난번 끝난 자리" 에서
        // 시작하면 그건 프리뷰가 아니라 남은 찌꺼기다.
        set({ enabled, stage: "connect", bulk: null, loginModel: null });
      },

      restart: () => {
        clearTimers();
        set({ stage: "connect", bulk: null, loginModel: null });
      },

      setStage: (stage) => {
        clearTimers();
        set({
          stage,
          bulk: previewBulk(stage, get().bulk?.total ?? 0, 0),
          loginModel:
            stage === "awaiting_auth" ? (get().loginModel ?? "claude") : null,
        });
        // 수동으로 승인 대기까지 밀었다면 그 뒤는 다시 자동으로 굴러간다.
        if (stage === "awaiting_auth") later(finishAuth, PREVIEW_AUTH_MS);
        if (stage === "sample")
          later(() => set({ stage: "done" }), PREVIEW_SAMPLE_MS);
      },

      advance: () => get().setStage(nextPreviewStage(get().stage)),

      startInstallAll: (rowCount) => {
        // ★`connect` 에서만 설치 패스를 연다. 재클릭 무시(실 스토어의 running
        // 가드)에 더해, 이미 설치가 끝난 국면(sign_in 이후)에서 모달이 다시
        // 열렸을 때 흐름이 되감기지 않게 한다 — 실 흐름에서도 이미 깔린 행은
        // `pendingInstallRows` 가 걸러 설치 패스가 사실상 비어 있다.
        if (get().stage !== "connect") return;
        clearTimers();
        const total = Math.max(rowCount, 1);
        set({ stage: "installing", bulk: previewBulk("installing", total, 0) });
        for (let i = 1; i <= total; i++) {
          later(() => {
            set({ bulk: previewBulk("installing", total, i) });
            if (i === total)
              set({
                stage: "sign_in",
                bulk: previewBulk("sign_in", total, total),
              });
          }, PREVIEW_INSTALL_STEP_MS * i);
        }
      },

      startSignIn: (model) => {
        if (get().stage === "awaiting_auth") return; // 같은 로그인을 두 번 띄우지 않는다
        set({ stage: "awaiting_auth", loginModel: model });
        later(finishAuth, PREVIEW_AUTH_MS);
      },
    };
  },
);

/** 테스트 전용 — 남은 전이를 지우고 초기 상태로. */
export function resetOnboardingPreviewForTest(): void {
  clearTimers();
  useOnboardingPreviewStore.setState({
    enabled: false,
    stage: "connect",
    bulk: null,
    loginModel: null,
  });
}
