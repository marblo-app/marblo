import { useCallback, useEffect, useRef, useState } from "react";
// 메시지는 콜백 안에서만 필요해 순수 `t` 를 쓴다 — 스토어의 현재 로케일을
// 그때그때 읽으므로, 훅의 t 를 클로저에 가둘 때 생기는 로케일 어긋남이 없다.
import { t, useTranslation } from "../../lib/i18n";
import { useCliSetupStore, ROWS } from "../../stores/cliSetupStore";
import {
  runHeadlessOnce,
  type HeadlessRunHandle,
} from "../../services/headlessRun";
import { useEditorStore } from "../../stores/editorStore";
import { useProjectStore } from "../../stores/projectStore";
import {
  buildQuickActionPrompt,
  exceedsSelectionLimit,
  extractReplacementCode,
  headlessArgs,
  MAX_SELECTION_LINES,
  parseHeadlessOutput,
  pickQuickActionCli,
  QUICK_ACTION_TIMEOUT_MS,
  type QuickActionCli,
  type QuickActionCliCandidate,
  type QuickActionId,
} from "./quickActions";

/**
 * 코드탭 퀵액션 엔진 — 설계는 `docs/CODE-QUICK-ACTIONS.md` §3.
 *
 * 하는 일은 하나다: **연결된 CLI 를 헤드리스로 딱 한 번 돌리고 텍스트를 받아
 * 온다.** 새 모델도, 자동완성 엔진도, 새 IPC 도 없다 — 기존 `pty:*` 채널만
 * 쓰므로 메인 프로세스는 한 줄도 바뀌지 않는다.
 *
 * 연속 추론이 물리적으로 불가능한 구조인 점이 핵심이다: 프로세스는 클릭당
 * 한 번 뜨고 끝나며, 세션도 재개도 캐시된 컨텍스트도 없다. 유휴 비용이 정확히
 * 0 인 이유가 이것이다.
 */

export type QuickActionStatus = "running" | "done" | "error" | "needs-cli";

export interface QuickActionState {
  action: QuickActionId;
  filePath: string;
  /** 실행 당시의 선택 범위(1-based, 포함). 결과 적용 대상. */
  startLine: number;
  endLine: number;
  /**
   * 실행 당시 그 범위의 원문. diff 의 `-` 쪽이자, **적용 직전 드리프트 검사**의
   * 기준이다 — CLI 가 도는 몇 초 사이 사용자가 그 줄을 고쳤을 수 있고, 그때
   * 줄번호만 믿고 치환하면 남의 코드를 덮어쓴다.
   */
  original: string;
  status: QuickActionStatus;
  /** 실제로 돌린 CLI. needs-cli 면 null. */
  cli: QuickActionCli | null;
  /** explain 의 답변, 또는 fix 에서 코드블록 추출에 실패했을 때의 원문. */
  text: string;
  /** fix 성공 시 선택 범위를 대체할 코드. */
  replacement: string | null;
  /** 선택이 상한을 넘어 잘린 채 전달됐는가(explain 한정). */
  truncated: boolean;
  error: string;
}

export interface QuickActionRequest {
  action: QuickActionId;
  filePath: string;
  language: string;
  /** 에디터 모델의 현재 전체 내용. 디스크가 아니라 **화면의 진실**을 보낸다. */
  content: string;
  startLine: number;
  endLine: number;
}

/**
 * ★PTY 1회 실행은 `services/headlessRun` 이 든다. 여기 있던 구현을 그대로 뽑은
 * 것이다 — 온보딩의 구독/크레딧 프로브가 같은 실행·정리 순서를 필요로 해서,
 * 두 벌을 두는 대신 한 벌을 공유한다(한쪽만 fd 를 흘리는 일이 없도록).
 */
type RunHandle = HeadlessRunHandle;

let runSeq = 0;

export interface CodeQuickAction {
  state: QuickActionState | null;
  run: (request: QuickActionRequest) => Promise<void>;
  /** 결과/에러 패널을 닫는다. 실행 중이면 취소도 겸한다. */
  dismiss: () => void;
  /** 연결된 CLI 가 없을 때 원클릭 설치·사인인 표면으로 보낸다. */
  openCliSetup: () => void;
}

export function useCodeQuickAction(): CodeQuickAction {
  const { locale } = useTranslation();
  const [state, setState] = useState<QuickActionState | null>(null);
  const activeRef = useRef<RunHandle | null>(null);
  const localeRef = useRef(locale);
  localeRef.current = locale;

  useEffect(() => {
    return () => {
      const active = activeRef.current;
      if (active) {
        active.cancelled = true;
        void window.electronAPI.pty.kill(active.ptyId).catch(() => {});
        window.electronAPI.pty.removeListeners(active.ptyId);
      }
    };
  }, []);

  const dismiss = useCallback(() => {
    const active = activeRef.current;
    if (active) {
      active.cancelled = true;
      // 플래그만 세우고 두면 CLI 는 최대 120초까지 계속 돌고, 그동안 "동시 실행
      // 1건" 가드가 다음 클릭을 막는다 — 취소가 취소로 안 보인다. 실제로 죽인다.
      void window.electronAPI.pty.kill(active.ptyId).catch(() => {});
    }
    setState(null);
  }, []);

  const openCliSetup = useCallback(() => {
    window.dispatchEvent(new CustomEvent("marblo:open-cli-setup"));
  }, []);

  const run = useCallback(async (request: QuickActionRequest) => {
    // 동시 실행 1건. 연타로 프로세스를 쌓지 않는다.
    if (activeRef.current) return;

    const { action, filePath, language, content, startLine, endLine } = request;
    const fileLines = content.split("\n");
    const base = {
      action,
      filePath,
      startLine,
      endLine,
      original: fileLines.slice(startLine - 1, endLine).join("\n"),
      cli: null as QuickActionCli | null,
      text: "",
      replacement: null as string | null,
      truncated: false,
      error: "",
    };

    const selectedCount = endLine - startLine + 1;
    if (action === "fix" && exceedsSelectionLimit(selectedCount)) {
      // 잘린 선택으로 만든 치환은 범위와 어긋나 코드를 깬다 — 자르지 말고 거절.
      setState({
        ...base,
        status: "error",
        error: t("code.quickAction.tooLong", { max: MAX_SELECTION_LINES }),
      });
      return;
    }

    const probe = useCliSetupStore.getState().results;
    const candidates: QuickActionCliCandidate[] = ROWS.filter(
      (r) => r.model === "claude" || r.model === "codex",
    ).map((r) => ({
      model: r.model as QuickActionCli,
      ready: !!probe[r.id]?.installed && !!probe[r.id]?.authenticated,
    }));
    const cli = pickQuickActionCli(candidates);
    if (!cli) {
      setState({ ...base, status: "needs-cli" });
      return;
    }

    // cwd 는 코드탭이 실제로 보고 있는 루트(워크트리일 수 있다) → 없으면
    // 프로젝트 폴더. 둘 다 없으면 열린 파일이 없다는 뜻이라 실행할 게 없다.
    const cwd =
      useEditorStore.getState().rootPath ||
      useProjectStore.getState().currentProject?.folderPath ||
      "";
    if (!cwd) {
      setState({
        ...base,
        status: "error",
        error: t("code.quickAction.noRoot"),
      });
      return;
    }

    const { prompt, truncated } = buildQuickActionPrompt({
      action,
      filePath,
      language,
      fileLines,
      startLine,
      endLine,
      locale: localeRef.current,
    });

    const handle: RunHandle = {
      ptyId: `code-quick-${++runSeq}-${Math.random().toString(36).slice(2, 8)}`,
      cancelled: false,
    };
    activeRef.current = handle;
    setState({ ...base, status: "running", cli, truncated });

    let raw = "";
    let exitCode: number | null = null;
    let failure = "";
    try {
      const command =
        cli === "claude"
          ? (await window.electronAPI.claude.version()).command || "claude"
          : "codex";
      const result = await runHeadlessOnce({
        command,
        args: headlessArgs(cli, prompt),
        cwd,
        timeoutMs: QUICK_ACTION_TIMEOUT_MS,
        name: `Quick action ${handle.ptyId}`,
        handle,
      });
      raw = result.raw;
      exitCode = result.exitCode;
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    } finally {
      activeRef.current = null;
    }

    if (handle.cancelled) return;

    if (failure) {
      setState({
        ...base,
        status: "error",
        cli,
        truncated,
        error: t("code.quickAction.spawnFailed", { message: failure }),
      });
      return;
    }

    const answer = parseHeadlessOutput(cli, raw);
    if (!answer) {
      // 조용한 실패 금지 — 왜 비었는지(종료코드 + 꼬리 출력)를 그대로 보여준다.
      setState({
        ...base,
        status: "error",
        cli,
        truncated,
        error: t("code.quickAction.emptyResult", {
          code: exitCode === null ? "?" : String(exitCode),
        }),
        text: raw.slice(-2000).trim(),
      });
      return;
    }

    if (action === "explain") {
      setState({
        ...base,
        status: "done",
        cli,
        truncated,
        text: answer,
      });
      return;
    }

    const replacement = extractReplacementCode(answer);
    if (replacement === null) {
      // 산문을 코드로 오인해 파일에 붙여넣느니, 원문을 보여주고 사용자가 판단.
      setState({
        ...base,
        status: "error",
        cli,
        truncated,
        error: t("code.quickAction.noCodeBlock"),
        text: answer,
      });
      return;
    }

    setState({
      ...base,
      status: "done",
      cli,
      truncated,
      text: answer,
      replacement,
    });
  }, []);

  return { state, run, dismiss, openCliSetup };
}
