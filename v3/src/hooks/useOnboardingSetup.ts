import { useMemo } from "react";
import {
  PREVIEW_SESSION_ID,
  previewCliReady,
  previewOverridesGate,
  previewResults,
  previewSampleStatus,
  previewSignInModel,
} from "../lib/onboardingPreview";
import { oneClickInstallRows } from "../lib/oneClickSetup";
import type { BulkInstallProgress, CliProbeLike } from "../lib/oneClickSetup";
import type { FundingProbeState } from "../lib/fundingProbe";
import {
  ROWS,
  useCliSetupStore,
  type CliModel,
  type CliRow,
  type CliState,
} from "../stores/cliSetupStore";
import { useFirstRunSampleStore } from "../stores/firstRunSampleStore";
import { useOnboardingPreviewStore } from "../stores/onboardingPreviewStore";
import { launchLogin, oneClickSignIn } from "../services/cliSetupActions";
import telemetry from "../services/telemetryService";
import type { FirstRunSampleStatus } from "../stores/firstRunSampleStore";

/**
 * ★비기너 온보딩 표면(연결 게이트 · 원클릭 모달 · 폴더 게이트)이 읽는 **단 하나의
 * 뷰모델**. 실제 흐름과 프리뷰(시연) 흐름이 여기서 갈린다.
 *
 * 왜 이 층이 필요한가(티켓 MA5PnltkHBFbgcRvjo0r): 프리뷰는 "이미 설치·인증된
 * 기계에서 fresh 유저 화면을 다시 보는" 모드다. 가장 짧은 구현은 `cliSetupStore`
 * 에 가짜 결과를 밀어 넣는 것이지만, 그 스토어의 `ready` 는 오케 자동기동
 * (`marblo:cli-auth-ready`)과 스폰 게이트가 함께 읽는 **실제 게이트**다 — 프리뷰가
 * 그걸 false 로 만들면 시연 도중 진짜 오케가 안 뜨고 진짜 스폰이 막힌다. 그래서
 * 가로채는 자리를 화면 바로 앞으로 내렸다.
 *
 * 규칙:
 *  - 프리뷰가 아닐 때는 **예전 그대로**다(같은 스토어 값, 같은 액션).
 *  - 프리뷰일 때 이 훅이 돌려주는 액션은 전부 시뮬이다 — `harness.install`,
 *    `harness.cliAuthCheck`, PTY 스폰, 키체인 중 어느 것도 부르지 않는다.
 *  - 프리뷰 시뮬이 끝나면(`done`) 값이 다시 실제 스토어로 흘러간다. 토글을 끄는
 *    걸 잊어도 사용자가 가짜 화면에 갇히지 않는다.
 */
export interface OnboardingSetupView {
  /** 지금 이 값들이 시뮬인가. 화면은 이 플래그로 터미널 종류를 고른다. */
  preview: boolean;
  /** 오케 후보 중 하나가 설치+인증 — 연결 게이트 통과 판정. */
  ready: boolean;
  results: Record<string, CliProbeLike | undefined>;
  /**
   * 렌더 스냅샷이 아니라 **지금 이 순간**의 프로브 결과. 클릭 핸들러가 "이미
   * 깔렸나" 를 물을 때 쓴다 — 백그라운드 자동설치가 방금 끝났을 수 있는데
   * 리액트 상태는 그보다 늦어서, 스냅샷으로 판단하면 셸 인스톨러를 한 번 더
   * 돌리게 된다(원래 `useCliSetupStore.getState()` 를 직접 읽던 이유).
   */
  readResults: () => Record<string, CliProbeLike | undefined>;
  states: Record<string, CliState | undefined>;
  bulk: BulkInstallProgress | null;
  installErrors: Record<string, string>;
  installing: string | null;
  /** 첫 실행 샘플 폴더 자동연결(#872)의 진행 상태. */
  sampleStatus: FirstRunSampleStatus;

  /** "모두 설치" — 실 경로는 `runInstallAll`, 프리뷰는 진행률 시뮬. */
  installAll: () => void;
  /** 한 줄 설치(택1 카드) — 프리뷰에서는 일괄 시뮬로 합류한다. */
  installOne: (row: CliRow) => Promise<void>;
  /**
   * 원클릭 자동 사인인. 로그인 터미널 세션이 생기면 `onSession` 으로 알린다
   * (프리뷰에서는 `PREVIEW_SESSION_ID` — 실 PTY 가 아니다).
   */
  signIn: (onSession: (sessionId: string) => void) => CliModel | null;
  /** 택1 카드의 로그인. 세션 id(스폰 실패면 null)를 돌려준다. */
  login: (model: CliModel, action?: string) => Promise<string | null>;
  /** 수동 "다시 확인" — 프리뷰에서는 실 프로브를 돌리지 않는다. */
  recheck: () => void;

  /**
   * ★인증 다음 칸 — "로그인은 됐는데 진짜 도는가"(티켓 sVdwTsiGq6qZVAmSkwZB).
   * 프리뷰에서는 **언제나 판정 없음**이다: 시연은 정상 흐름을 보여주는 것이고,
   * 실 헤드리스 턴을 태우지 않는다는 프리뷰의 계약도 그대로 지켜야 한다.
   */
  funding: FundingProbeState;
  /** "이미 구독했어요 → 다시 확인" — 프로브를 한 번 더 돌린다. */
  recheckFunding: () => void;
}

const ONE_CLICK_ROW_IDS = oneClickInstallRows(ROWS).map((r) => r.id);
const ALL_ROW_IDS = ROWS.map((r) => r.id);

export function useOnboardingSetup(): OnboardingSetupView {
  // ── 실제 상태 ──────────────────────────────────────────────────────────
  const realReady = useCliSetupStore((s) => s.ready);
  const realResults = useCliSetupStore((s) => s.results);
  const realStates = useCliSetupStore((s) => s.states);
  const realBulk = useCliSetupStore((s) => s.bulkInstall);
  const installErrors = useCliSetupStore((s) => s.installErrors);
  const installing = useCliSetupStore((s) => s.installing);
  const runInstall = useCliSetupStore((s) => s.runInstall);
  const runInstallAll = useCliSetupStore((s) => s.runInstallAll);
  const probeAll = useCliSetupStore((s) => s.probeAll);
  const fundingChecking = useCliSetupStore((s) => s.fundingChecking);
  const fundingOutcome = useCliSetupStore((s) => s.fundingOutcome);
  const runFundingProbe = useCliSetupStore((s) => s.runFundingProbe);
  const realSampleStatus = useFirstRunSampleStore((s) => s.status);

  // ── 프리뷰 상태 ────────────────────────────────────────────────────────
  const previewEnabled = useOnboardingPreviewStore((s) => s.enabled);
  const stage = useOnboardingPreviewStore((s) => s.stage);
  const previewBulkState = useOnboardingPreviewStore((s) => s.bulk);
  const startInstallAll = useOnboardingPreviewStore((s) => s.startInstallAll);
  const startSignIn = useOnboardingPreviewStore((s) => s.startSignIn);

  const preview = previewOverridesGate(previewEnabled, stage);

  const simResults = useMemo(
    () =>
      preview
        ? previewResults(ALL_ROW_IDS, ONE_CLICK_ROW_IDS, stage)
        : ({} as Record<string, CliProbeLike>),
    [preview, stage],
  );

  const simStates = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(simResults).map(([id, r]) => [
          id,
          { ...r, checking: false } as CliState,
        ]),
      ),
    [simResults],
  );

  return useMemo<OnboardingSetupView>(() => {
    if (!preview) {
      return {
        preview: false,
        ready: realReady,
        results: realResults,
        readResults: () => useCliSetupStore.getState().results,
        states: realStates,
        bulk: realBulk,
        installErrors,
        installing,
        sampleStatus: realSampleStatus,
        installAll: () => void runInstallAll(oneClickInstallRows(ROWS)),
        installOne: (row) => runInstall(row),
        signIn: (onSession) => oneClickSignIn(onSession),
        login: (model, action) => launchLogin(model, action),
        recheck: () => void probeAll(),
        funding: { checking: fundingChecking, outcome: fundingOutcome },
        // ★스톨 계측(티켓 9dXgBdkGn1LyJokShh1g): "이미 구독했어요 → 다시 확인"
        // 의 판정도 남긴다. 이 축이 없으면 "구독을 붙이고 실제로 풀린 사람"
        // (unfunded → ok 전이)을 셀 수 없고, 그게 온램프 투자 효과의 결과지표다.
        recheckFunding: () =>
          void runFundingProbe().then((outcome) => {
            if (!outcome) return;
            telemetry.fundingProbe(
              outcome.verdict,
              outcome.model,
              "recheck",
              outcome.blockedReason,
            );
          }),
      };
    }

    // ── 시뮬 경로 — 여기서 나가는 IPC 는 하나도 없다 ──────────────────────
    const startInstall = () => startInstallAll(ONE_CLICK_ROW_IDS.length);
    return {
      preview: true,
      ready: previewCliReady(stage),
      results: simResults,
      readResults: () => simResults,
      states: simStates,
      bulk: previewBulkState,
      // 프리뷰는 실패를 만들지 않는다(실패 경로는 실 화면에서 이미 검증됐고,
      // 가짜 실패를 그리면 시연이 거짓말을 한다).
      installErrors: {},
      installing: null,
      sampleStatus: previewSampleStatus(stage),
      installAll: startInstall,
      installOne: async () => startInstall(),
      signIn: (onSession) => {
        const model = previewSignInModel(ROWS, simResults);
        if (!model) return null;
        startSignIn(model);
        onSession(PREVIEW_SESSION_ID);
        return model;
      },
      login: async (model) => {
        startSignIn(model);
        return PREVIEW_SESSION_ID;
      },
      recheck: () => {
        /* 프리뷰에서는 프로브를 돌리지 않는다 — 국면이 스스로 굴러간다 */
      },
      // 프리뷰는 구독/크레딧 문제를 **연출하지 않는다**: 시연의 목적은 신규
      // 유저의 정상 경로를 보는 것이고, 실 헤드리스 턴도 태우지 않는다.
      funding: { checking: false, outcome: null },
      recheckFunding: () => {},
    };
  }, [
    preview,
    stage,
    simResults,
    simStates,
    previewBulkState,
    realReady,
    realResults,
    realStates,
    realBulk,
    realSampleStatus,
    installErrors,
    installing,
    runInstall,
    runInstallAll,
    probeAll,
    fundingChecking,
    fundingOutcome,
    runFundingProbe,
    startInstallAll,
    startSignIn,
  ]);
}
