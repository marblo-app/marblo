import { useEffect, useRef } from "react";
import { useAuth } from "./useAuth";
import { useEditorStore } from "../stores/editorStore";
import { useFirstRunSampleStore } from "../stores/firstRunSampleStore";
import { useProjectStore } from "../stores/projectStore";
import { useLocaleStore } from "../lib/i18n";
import {
  hasAttemptedSampleSeed,
  rememberSampleSeedAttempt,
  shouldSeedSampleProject,
} from "../lib/firstRunSample";
import telemetry from "../services/telemetryService";

/**
 * 첫 실행에서 폴더를 대신 만들어 연결한다 (티켓 yk8ouW2pS6nGzH272rXy).
 *
 * ── 없앤 것 ──────────────────────────────────────────────────────────────────
 * 폴더가 없으면 오케스트레이터는 **아예 기동 시도조차 하지 않는다**
 * (useOrchestratorAutoLaunch 는 `currentProject.folderPath` 가 null 이면 즉시
 * return). 비기너 셸은 한 발 더 나가 folder gate 화면으로 오케 채팅 자체를
 * 가린다. 그래서 신규 유저는 "설치 → 로그인 → 폴더 선택" 을 다 넘기기 전엔
 * 제품이 움직이는 걸 한 번도 못 본다. 이 훅이 마지막 관문을 지운다.
 *
 * ── 왜 빈 폴더가 아닌가 ──────────────────────────────────────────────────────
 * 빈 폴더로도 오케는 열린다. 하지만 비기너 셸의 예제 칩이 전부 헛돈다 —
 * "README 를 읽고 시작 가이드를 정리해 줘"(읽을 README 없음),
 * "테스트가 없는 함수에 테스트를 붙여 줘"(함수 없음). 열린 화면은 첫 성공이
 * 아니다. main 의 sample-project 가 시드하는 미니 프로젝트는 그 칩 세 개가
 * 그대로 먹히도록 구성돼 있다(README · 테스트 없는 src/format.js · 설명할 구조).
 *
 * ── 안 하는 경우 ─────────────────────────────────────────────────────────────
 * 판단은 전부 lib/firstRunSample 의 순수 함수에 있다. 요지는 "이미 자기 것을
 * 쓰는 사람은 절대 건드리지 않는다" — 프로젝트가 하나라도 있거나, 이 창이 이미
 * 폴더를 보고 있거나, 사용자가 직접 고르려고 연 새 창이면 물러선다. 시드는
 * 기기당 1회만 시도하므로 샘플을 지운 사용자에게 되살아나지 않는다.
 */
/**
 * 이 창이 복원하려는 폴더 — 창별 레코드가 먼저, 없으면 전역 app-state.
 * (`useSessionRestore.resolveRestoreSource` 와 같은 우선순위. 새 창은 애초에
 * 시드 대상이 아니므로 isNewWindow 분기는 여기서 다시 볼 필요가 없다.)
 */
async function readRestoreTarget(accountUid: string): Promise<string | null> {
  try {
    const perWindow = await window.electronAPI.window
      .getRestoreState(accountUid)
      .catch(() => ({}) as { rootPath?: string });
    if (perWindow?.rootPath) return perWindow.rootPath;
    const global = await window.electronAPI.appState
      .load({ accountUid })
      .catch(() => ({}) as { lastRootPath?: string });
    return global?.lastRootPath ?? null;
  } catch {
    // 읽을 수 없으면 "복원 대상이 있다"고 본다 — 자동 연결을 안 하는 쪽이 안전하다.
    return "unknown";
  }
}

export function useFirstRunSampleProject(
  connectFolderPath: (dir: string) => Promise<void>,
): void {
  const { user } = useAuth();
  const projects = useProjectStore((s) => s.projects);
  const projectsHydrated = useProjectStore((s) => s.projectsHydrated);
  const currentProject = useProjectStore((s) => s.currentProject);
  const rootPath = useEditorStore((s) => s.rootPath);

  // 세션 내 재진입 방지. 시드는 멱등이지만 프로젝트 등록은 아니다 — 두 번 돌면
  // 같은 폴더로 프로젝트가 두 개 생길 수 있다(중복 가드는 findByPathOrRemote 가
  // 잡지만, 그건 Firestore 왕복 뒤라 경합에 열려 있다).
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    if (!user) return;

    const gate = {
      signedIn: true,
      projectsHydrated,
      projectCount: projects.length,
      hasRootPath: !!rootPath,
      hasCurrentProject: !!currentProject,
      isNewWindow: (() => {
        try {
          return window.electronAPI.window.isNewWindow();
        } catch {
          // 알 수 없으면 새 창으로 간주 — 자동 연결을 안 하는 쪽이 안전하다.
          return true;
        }
      })(),
      alreadyAttempted: hasAttemptedSampleSeed(),
      // 복원 레코드는 IPC 라 비동기다 — 값싼 동기 조건을 먼저 걸러내고, 실제
      // 판단은 아래에서 그 값을 채워 **같은 규칙 표**로 한 번 더 한다.
      hasRestoreTarget: false,
    };
    if (!shouldSeedSampleProject(gate)) return;

    startedRef.current = true;
    // 화면용 상태 — 이 1~2초 동안 셸이 "폴더를 골라 주세요" 를 그리면 유저가
    // 곧 자동으로 붙을 폴더를 직접 고르러 간다(그리고 화면이 튄다).
    const setStatus = useFirstRunSampleStore.getState().setStatus;
    setStatus("preparing");
    void (async () => {
      try {
        // ★세션 복원이 정착하기 전에 결정하지 않는다. 복원은 main 으로 두 번
        // 왕복하므로 위 동기 판단 시점엔 rootPath 가 아직 비어 있다 — 그대로
        // 진행하면 폴더를 쓰던 창이 샘플로 갈아탄다(E2E Z6).
        const restoreTarget = await readRestoreTarget(user.uid);
        if (
          !shouldSeedSampleProject({
            ...gate,
            hasRestoreTarget: !!restoreTarget,
          })
        ) {
          return;
        }
        const result = await window.electronAPI.sample.ensure(
          useLocaleStore.getState().locale,
        );
        if (!result?.ok || !result.path) {
          telemetry.sampleProjectSeeded("failed");
          setStatus("failed");
          console.warn(
            "[firstRunSample] could not prepare the sample project:",
            result?.error,
          );
          // 마커를 남기지 않는다 — 디스크가 잠깐 막힌 경우라면 다음 실행에
          // 다시 시도할 값어치가 있다(세션 내 반복은 startedRef 가 막는다).
          return;
        }
        telemetry.sampleProjectSeeded(result.created ? "created" : "reused");
        rememberSampleSeedAttempt(result.path);
        // 수동 폴더 픽과 **정확히 같은** 경로로 등록한다 — 중복 가드·기기별 경로
        // 기록·오케 자동기동이 전부 여기에 붙어 있다.
        await connectFolderPath(result.path);
        setStatus("connected");
      } catch (err) {
        // 자동 편의 기능이 첫 실행을 깨뜨리면 안 된다. 실패하면 지금까지와
        // 똑같이 사용자가 폴더를 고르는 화면으로 남는다.
        telemetry.sampleProjectSeeded("failed");
        setStatus("failed");
        console.warn("[firstRunSample] auto-connect failed (non-fatal):", err);
      }
    })();
  }, [
    user,
    projects.length,
    projectsHydrated,
    currentProject,
    rootPath,
    connectFolderPath,
  ]);
}
