import { execFile, spawn, ChildProcess } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { registerLocalOllamaModels } from "./model-registry";

/**
 * **로컬 모델(Ollama) 스토어** 메인 프로세스 축 — first-party 큐레이션 카탈로그 +
 * 하드웨어 게이트 + `ollama pull` 원클릭.
 *
 * 공개 레지스트리(registry-client/installer)와 **완전히 분리된 경로**다(§4.4
 * 신뢰경계): 여기 항목은 앱에 하드코딩된 first-party 큐레이션이고, 다운로드는
 * ollama 공식 라이브러리에서만 일어난다. untrusted 레지스트리 입력이 이 경로로
 * 들어올 수 없고, 렌더러가 보낸 id 도 아래 카탈로그 화이트리스트로만 해석된다
 * (렌더러 불신 원칙 — 임의 문자열이 `ollama pull` argv 로 새지 않는다).
 *
 * 유령비용 방지: pull 이 끝나면 `ollama list` **실측** id 만
 * `registerLocalOllamaModels` 로 모델 레지스트리에 등록한다 — 설치되지 않은 id 가
 * 스폰 축(핀/단가표)에 존재하게 되는 일이 없다.
 */

// ── first-party 카탈로그 ──────────────────────────────────────────

export type LocalModelCategory = "coding" | "general" | "reasoning";

/**
 * 로컬 모델의 하네스 tool-use 적합성.
 *
 * 실측(ollama 0.32.14 + claude CLI env-swap): 소형(0.5b)은 직접 `ollama run` /
 * tools 없는 `/v1/messages` 에서는 정상 대화하지만, Marblo 가 MCP 툴 정의 +
 * 에이전트 system(tool 강제)을 주입하면 tool_use JSON 을 흉내 내며 엉뚱한 답을
 * 낸다. 그래서 7B 미만은 대화·테스트 전용, 에이전트/오케 실작업은 7B+
 * (특히 coder)만 tool-use 지원으로 표시한다.
 */
export type LocalToolSupport = "chat-only" | "tool-use";

export interface LocalModelCatalogEntry {
  /** ollama 공식 라이브러리 태그 — `ollama pull <id>` 에 그대로 쓰인다. */
  id: string;
  displayName: string;
  /** 스토어 구분 라벨 — 코딩 특화 / 범용 / 추론. */
  category: LocalModelCategory;
  categoryLabel: string;
  /** 다운로드 크기(MB). ollama.com/library/<model>/tags 실측값(2026-08-18). */
  downloadSizeMB: number;
  /** 최소 권장 RAM(GB) — 모델 상주 + OS/앱 여유의 보수적 큐레이션 값. */
  minRamGB: number;
  /** 모델 자체의 최대 컨텍스트(토큰). 실행 시 기본 컨텍스트는 이보다 작다(가이드 참조). */
  contextTokens: number;
  /**
   * 하네스 tool-use 적합성. 카드 배지·스폰 분기(대화모드 vs MCP 에이전트)의
   * 단일 소스. `resolveLocalToolSupport` 가 id 파라미터 규모로 채운다.
   */
  toolSupport: LocalToolSupport;
  /** UI 배지 문구 — "대화 전용" / "tool-use 지원". */
  toolSupportLabel: string;
}

/**
 * ollama 태그에서 파라미터 규모(B)를 읽는다. 못 읽으면 null.
 * 예: `qwen2.5:0.5b`→0.5, `phi3:mini`→3.8, `deepseek-r1:8b-0528-…`→8.
 */
export function parseLocalParamBillions(id: string): number | null {
  const trimmed = id.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed === "phi3:mini" || trimmed.startsWith("phi3:mini-")) return 3.8;
  const match = /(\d+(?:\.\d+)?)b\b/.exec(trimmed);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * 로컬 모델 id → tool-use 적합성.
 *
 * 임계 7B 는 실측·제품 안내("소형=테스트·대화, 실작업=7b+ coder")와 맞춘다.
 * 파라미터를 못 읽으면 안전하게 chat-only.
 */
export function resolveLocalToolSupport(id: string): LocalToolSupport {
  const billions = parseLocalParamBillions(id);
  if (billions === null) return "chat-only";
  return billions >= 7 ? "tool-use" : "chat-only";
}

export function localToolSupportLabel(support: LocalToolSupport): string {
  return support === "tool-use" ? "tool-use 지원" : "대화 전용";
}

function withToolSupport(
  entry: Omit<LocalModelCatalogEntry, "toolSupport" | "toolSupportLabel">,
): LocalModelCatalogEntry {
  const toolSupport = resolveLocalToolSupport(entry.id);
  return {
    ...entry,
    toolSupport,
    toolSupportLabel: localToolSupportLabel(toolSupport),
  };
}

/**
 * 소형 우선 + Qwen3/Qwen Coder/최신 범용/추론 대표 큐레이션. 크기·컨텍스트는
 * ollama 공식 라이브러리 tags 페이지(ollama.com/library/<model>/tags)
 * 대조값이다 — 추측으로 고치지 말 것.
 */
export const LOCAL_MODEL_CATALOG: readonly LocalModelCatalogEntry[] = [
  withToolSupport({
    id: "qwen2.5:0.5b",
    displayName: "Qwen 2.5 0.5B",
    category: "general",
    categoryLabel: "범용",
    downloadSizeMB: 398,
    minRamGB: 4,
    contextTokens: 32_000,
  }),
  withToolSupport({
    id: "qwen3:0.6b",
    displayName: "Qwen 3 0.6B",
    category: "general",
    categoryLabel: "범용",
    downloadSizeMB: 523,
    minRamGB: 4,
    contextTokens: 40_000,
  }),
  withToolSupport({
    id: "qwen2.5:1.5b",
    displayName: "Qwen 2.5 1.5B",
    category: "general",
    categoryLabel: "범용",
    downloadSizeMB: 986,
    minRamGB: 4,
    contextTokens: 32_000,
  }),
  withToolSupport({
    id: "llama3.2:1b",
    displayName: "Llama 3.2 1B",
    category: "general",
    categoryLabel: "범용",
    downloadSizeMB: 1_300,
    minRamGB: 4,
    contextTokens: 128_000,
  }),
  withToolSupport({
    id: "gemma2:2b",
    displayName: "Gemma 2 2B",
    category: "general",
    categoryLabel: "범용",
    downloadSizeMB: 1_600,
    minRamGB: 6,
    contextTokens: 8_000,
  }),
  withToolSupport({
    id: "llama3.2:3b",
    displayName: "Llama 3.2 3B",
    category: "general",
    categoryLabel: "범용",
    downloadSizeMB: 2_000,
    minRamGB: 8,
    contextTokens: 128_000,
  }),
  withToolSupport({
    id: "phi3:mini",
    displayName: "Phi-3 Mini (3.8B)",
    category: "general",
    categoryLabel: "범용",
    downloadSizeMB: 2_200,
    minRamGB: 8,
    contextTokens: 128_000,
  }),
  withToolSupport({
    id: "qwen3:4b",
    displayName: "Qwen 3 4B (256K)",
    category: "general",
    categoryLabel: "범용",
    downloadSizeMB: 2_500,
    minRamGB: 8,
    contextTokens: 256_000,
  }),
  withToolSupport({
    id: "qwen3:8b",
    displayName: "Qwen 3 8B",
    category: "general",
    categoryLabel: "범용",
    downloadSizeMB: 5_200,
    minRamGB: 12,
    contextTokens: 40_000,
  }),
  withToolSupport({
    id: "qwen3:14b",
    displayName: "Qwen 3 14B",
    category: "general",
    categoryLabel: "범용",
    downloadSizeMB: 9_300,
    minRamGB: 24,
    contextTokens: 40_000,
  }),
  withToolSupport({
    id: "qwen2.5-coder:7b",
    displayName: "Qwen 2.5 Coder 7B",
    category: "coding",
    categoryLabel: "코딩 특화",
    downloadSizeMB: 4_700,
    minRamGB: 12,
    contextTokens: 32_000,
  }),
  withToolSupport({
    id: "qwen2.5-coder:14b",
    displayName: "Qwen 2.5 Coder 14B",
    category: "coding",
    categoryLabel: "코딩 특화",
    downloadSizeMB: 9_000,
    minRamGB: 24,
    contextTokens: 32_000,
  }),
  withToolSupport({
    id: "qwen2.5-coder:32b",
    displayName: "Qwen 2.5 Coder 32B",
    category: "coding",
    categoryLabel: "코딩 특화",
    downloadSizeMB: 20_000,
    minRamGB: 48,
    contextTokens: 32_000,
  }),
  withToolSupport({
    id: "devstral:24b",
    displayName: "Devstral 24B",
    category: "coding",
    categoryLabel: "코딩 특화",
    downloadSizeMB: 14_000,
    minRamGB: 32,
    contextTokens: 128_000,
  }),
  withToolSupport({
    id: "codestral:22b",
    displayName: "Codestral 22B",
    category: "coding",
    categoryLabel: "코딩 특화",
    downloadSizeMB: 13_000,
    minRamGB: 32,
    contextTokens: 32_000,
  }),
  withToolSupport({
    id: "gemma3:4b",
    displayName: "Gemma 3 4B Vision",
    category: "general",
    categoryLabel: "범용",
    downloadSizeMB: 3_300,
    minRamGB: 8,
    contextTokens: 128_000,
  }),
  withToolSupport({
    id: "gemma3:12b",
    displayName: "Gemma 3 12B Vision",
    category: "general",
    categoryLabel: "범용",
    downloadSizeMB: 8_100,
    minRamGB: 24,
    contextTokens: 128_000,
  }),
  withToolSupport({
    id: "gemma3:27b",
    displayName: "Gemma 3 27B Vision",
    category: "general",
    categoryLabel: "범용",
    downloadSizeMB: 17_000,
    minRamGB: 48,
    contextTokens: 128_000,
  }),
  withToolSupport({
    id: "llama3.3:70b",
    displayName: "Llama 3.3 70B",
    category: "general",
    categoryLabel: "범용",
    downloadSizeMB: 43_000,
    minRamGB: 96,
    contextTokens: 128_000,
  }),
  withToolSupport({
    id: "phi4:14b",
    displayName: "Phi-4 14B",
    category: "general",
    categoryLabel: "범용",
    downloadSizeMB: 9_100,
    minRamGB: 24,
    contextTokens: 16_000,
  }),
  withToolSupport({
    id: "mistral-small:24b",
    displayName: "Mistral Small 24B",
    category: "general",
    categoryLabel: "범용",
    downloadSizeMB: 14_000,
    minRamGB: 32,
    contextTokens: 32_000,
  }),
  withToolSupport({
    id: "deepseek-r1:8b-0528-qwen3-q4_K_M",
    displayName: "DeepSeek-R1 Distill Qwen3 8B",
    category: "reasoning",
    categoryLabel: "추론",
    downloadSizeMB: 5_200,
    minRamGB: 12,
    contextTokens: 128_000,
  }),
  withToolSupport({
    id: "deepseek-r1:14b-qwen-distill-q4_K_M",
    displayName: "DeepSeek-R1 Distill Qwen 14B",
    category: "reasoning",
    categoryLabel: "추론",
    downloadSizeMB: 9_000,
    minRamGB: 24,
    contextTokens: 128_000,
  }),
  withToolSupport({
    id: "deepseek-r1:32b-qwen-distill-q4_K_M",
    displayName: "DeepSeek-R1 Distill Qwen 32B",
    category: "reasoning",
    categoryLabel: "추론",
    downloadSizeMB: 20_000,
    minRamGB: 48,
    contextTokens: 128_000,
  }),
  withToolSupport({
    id: "qwen3:30b",
    displayName: "Qwen 3 30B-A3B MoE (256K)",
    category: "general",
    categoryLabel: "범용",
    downloadSizeMB: 19_000,
    minRamGB: 48,
    contextTokens: 256_000,
  }),
  withToolSupport({
    id: "qwen3:32b",
    displayName: "Qwen 3 32B",
    category: "general",
    categoryLabel: "범용",
    downloadSizeMB: 20_000,
    minRamGB: 48,
    contextTokens: 40_000,
  }),
];

const CATALOG_BY_ID = new Map(LOCAL_MODEL_CATALOG.map((e) => [e.id, e]));

/** 렌더러가 보낸 id 를 카탈로그 화이트리스트로만 해석한다(임의 argv 차단). */
export function catalogEntry(id: string): LocalModelCatalogEntry | undefined {
  return CATALOG_BY_ID.get(id);
}

/**
 * 카탈로그 행이 있으면 그 toolSupport, 없으면 id 파라미터로 판정.
 * 카탈로그 밖 설치분(사용자가 직접 pull)도 같은 7B 임계를 쓴다.
 */
export function toolSupportForLocalModelId(id: string): LocalToolSupport {
  return catalogEntry(id)?.toolSupport ?? resolveLocalToolSupport(id);
}

/** 대화모드(MCP/내장 툴 비주입)로 스폰해야 하는 로컬 소형 모델인가. */
export function isLocalChatOnlyModel(id: string | undefined | null): boolean {
  if (!id || !id.trim()) return false;
  return toolSupportForLocalModelId(id.trim()) === "chat-only";
}

// ── 하드웨어 게이트(순수) ─────────────────────────────────────────

export type LocalModelAction =
  | "pull"
  | "installed"
  | "insufficient-ram"
  | "ollama-missing"
  | "daemon-stopped";

export interface LocalModelCard extends LocalModelCatalogEntry {
  /** 이 기기 메모리로 충분한가(minRamGB ≤ totalMemGB). */
  fits: boolean;
  installed: boolean;
  /** 카드의 단일 행동 상태 — UI 는 이 값 하나로 버튼/안내를 가른다. */
  action: LocalModelAction;
}

export interface OllamaAvailability {
  installed: boolean;
  daemonRunning: boolean;
}

/**
 * 카탈로그 × 실측(메모리·ollama 상태·설치 목록) → 카드 목록.
 *
 * 우선순위: installed > ollama-missing > daemon-stopped > insufficient-ram > pull.
 * 이미 설치된 모델은 RAM 이 모자라도 **installed 로 정직하게** 보인다 — 게이트는
 * 신규 다운로드를 막는 것이지 설치 사실을 감추는 것이 아니다(fits 플래그가
 * 경고 배지를 따로 준다).
 */
export function evaluateLocalModelCards(
  totalMemGB: number,
  ollama: OllamaAvailability,
  installedIds: readonly string[],
  catalog: readonly LocalModelCatalogEntry[] = LOCAL_MODEL_CATALOG,
): LocalModelCard[] {
  const installed = new Set(installedIds);
  return catalog.map((entry) => {
    const fits = totalMemGB >= entry.minRamGB;
    const action: LocalModelAction = installed.has(entry.id)
      ? "installed"
      : !ollama.installed
        ? "ollama-missing"
        : !ollama.daemonRunning
          ? "daemon-stopped"
          : !fits
            ? "insufficient-ram"
            : "pull";
    return { ...entry, fits, installed: installed.has(entry.id), action };
  });
}

/** Mac 은 통합메모리(GPU 공유)라 os.totalmem() 이 곧 모델 가용 메모리 축이다. */
export function localHardwareInfo(): {
  totalMemGB: number;
  platform: string;
  unifiedMemory: boolean;
} {
  return {
    totalMemGB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    platform: os.platform(),
    unifiedMemory: os.platform() === "darwin",
  };
}

// ── ollama 감지 · 목록 파싱 ──────────────────────────────────────

/**
 * `ollama list` 출력 → 설치된 모델 태그들. 형식(헤더 1줄 + 행당 첫 칼럼이 태그):
 *
 *   NAME            ID              SIZE      MODIFIED
 *   qwen2.5:0.5b    a8b0c5157701    397 MB    2 days ago
 */
export function parseOllamaListOutput(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^NAME\s/i.test(line))
    .map((line) => line.split(/\s+/)[0])
    .filter((name): name is string => !!name && name.includes(":"));
}

/**
 * `ollama pull` 출력 청크에서 진행률(%)을 읽는다. 없으면 null.
 * 여러 %가 오면 마지막 것 — 레이어별로 0→100 이 반복될 수 있어 단조증가는
 * 보장하지 않는다(UI 는 "진행 중" 표시로 쓴다).
 */
export function parseOllamaPullProgress(chunk: string): number | null {
  const matches = chunk.match(/(\d{1,3})%/g);
  if (!matches || matches.length === 0) return null;
  const last = parseInt(matches[matches.length - 1], 10);
  return Number.isFinite(last) && last >= 0 && last <= 100 ? last : null;
}

/** 패키지앱 PATH 에 없을 수 있는 표준 설치 경로 후보(플랫폼별). */
function ollamaCandidates(): string[] {
  if (os.platform() === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    return localAppData
      ? [path.join(localAppData, "Programs", "Ollama", "ollama.exe")]
      : [];
  }
  return ["/usr/local/bin/ollama", "/opt/homebrew/bin/ollama"];
}

function execFileText(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, windowsHide: true },
      (err, stdout) => resolve({ ok: !err, stdout: stdout ?? "" }),
    );
  });
}

export interface OllamaDetection {
  installed: boolean;
  /** 해석된 실행 커맨드(절대경로 또는 PATH 상의 "ollama"). 미설치면 null. */
  command: string | null;
  version?: string;
  daemonRunning: boolean;
  /** 데몬이 살아 있을 때의 설치 모델 실측 목록. */
  installedIds: string[];
}

/**
 * ollama 바이너리·데몬 존재를 실측한다. `--version` 은 데몬 없이도 0 으로
 * 끝나므로 설치 판정에 쓰고, `list` 성공 여부가 데몬 판정 + 설치 목록을 준다.
 */
export async function detectOllama(): Promise<OllamaDetection> {
  const candidates = [
    "ollama",
    ...ollamaCandidates().filter((p) => fs.existsSync(p)),
  ];
  for (const command of candidates) {
    const version = await execFileText(command, ["--version"], 5_000);
    if (!version.ok) continue;
    const versionText =
      /(\d+\.\d+[.\d]*)/.exec(version.stdout)?.[1] ?? undefined;
    const list = await execFileText(command, ["list"], 5_000);
    return {
      installed: true,
      command,
      ...(versionText ? { version: versionText } : {}),
      daemonRunning: list.ok,
      installedIds: list.ok ? parseOllamaListOutput(list.stdout) : [],
    };
  }
  return {
    installed: false,
    command: null,
    daemonRunning: false,
    installedIds: [],
  };
}

/**
 * 설치 실측 목록을 모델 레지스트리에 동기화한다(유령비용 방지의 단일 창구 —
 * **여기 넘어가는 id 는 항상 `ollama list` 출력**이지 요청값이 아니다).
 * 스폰 직전 경로(agent:launch)가 부르므로 10초 캐시로 과호출을 막는다.
 */
let lastSyncAt = 0;
let lastSyncResult: OllamaDetection | null = null;
let inflightSync: Promise<OllamaDetection> | null = null;

export async function syncInstalledLocalModels(
  force = false,
): Promise<OllamaDetection> {
  const now = Date.now();
  if (!force && lastSyncResult && now - lastSyncAt < 10_000) {
    return lastSyncResult;
  }
  if (inflightSync) return inflightSync;
  inflightSync = (async () => {
    const detection = await detectOllama();
    if (detection.installedIds.length > 0) {
      registerLocalOllamaModels(detection.installedIds);
    }
    lastSyncAt = Date.now();
    lastSyncResult = detection;
    inflightSync = null;
    return detection;
  })();
  return inflightSync;
}

// ── pull 매니저 ──────────────────────────────────────────────────

export interface LocalModelPullEvent {
  id: string;
  phase: "progress" | "done" | "error" | "cancelled";
  percent?: number;
  error?: string;
}

export interface LocalModelPullResult {
  success: boolean;
  cancelled?: boolean;
  error?: string;
}

/**
 * `ollama pull <id>` 스폰 + 진행률 스트리밍 + 취소. 모델당 동시 1개.
 * 취소는 SIGTERM — ollama pull 은 재개형이라 부분 다운로드가 유실되지 않는다.
 */
export class LocalModelPullManager {
  private active = new Map<
    string,
    { child: ChildProcess; cancelled: boolean }
  >();

  isPulling(id: string): boolean {
    return this.active.has(id);
  }

  cancel(id: string): boolean {
    const entry = this.active.get(id);
    if (!entry) return false;
    entry.cancelled = true;
    entry.child.kill("SIGTERM");
    return true;
  }

  pull(
    command: string,
    id: string,
    onEvent: (ev: LocalModelPullEvent) => void,
  ): Promise<LocalModelPullResult> {
    if (this.active.has(id)) {
      return Promise.resolve({ success: false, error: "already-pulling" });
    }
    return new Promise((resolve) => {
      const child = spawn(command, ["pull", id], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      const entry = { child, cancelled: false };
      this.active.set(id, entry);

      let lastPercent = -1;
      let stderrTail = "";
      const onChunk = (buf: Buffer) => {
        const text = buf.toString("utf8");
        stderrTail = (stderrTail + text).slice(-2_000);
        const percent = parseOllamaPullProgress(text);
        if (percent !== null && percent !== lastPercent) {
          lastPercent = percent;
          onEvent({ id, phase: "progress", percent });
        }
      };
      // ollama 는 진행률을 stderr 로 쓴다(비 TTY 포함). 양쪽 다 읽는다.
      child.stdout?.on("data", onChunk);
      child.stderr?.on("data", onChunk);

      const finish = (result: LocalModelPullResult) => {
        this.active.delete(id);
        resolve(result);
      };
      child.on("error", (err) => {
        onEvent({ id, phase: "error", error: err.message });
        finish({ success: false, error: err.message });
      });
      child.on("close", (code) => {
        if (entry.cancelled) {
          onEvent({ id, phase: "cancelled" });
          finish({ success: false, cancelled: true });
          return;
        }
        if (code === 0) {
          onEvent({ id, phase: "done", percent: 100 });
          finish({ success: true });
          return;
        }
        // 에러 본문은 stderr 꼬리에서 마지막 의미 있는 줄만 — 진행률 라인 제외.
        const lines = stderrTail
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 0 && !/%/.test(l));
        const error = lines[lines.length - 1] ?? `exit ${code}`;
        onEvent({ id, phase: "error", error });
        finish({ success: false, error });
      });
    });
  }
}
