import { execFile, spawn, ChildProcess } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { registerLocalOllamaModels } from "./model-registry";
import {
  isChatOnlyToolSupport,
  localToolSupportLabel,
  resolveLocalToolSupport,
  type LocalToolSupport,
} from "./local-tool-tier";

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
 * 티어 판정은 `local-tool-tier.ts` 가 단일 소스다(임계 상수·근거·실측 지표 포함).
 * 여기서는 기존 import 경로를 깨지 않도록 그대로 재수출한다.
 */
export {
  LOCAL_TOOL_USE_LITE_MIN_BILLIONS,
  LOCAL_TOOL_USE_MIN_BILLIONS,
  localToolSupportLabel,
  parseLocalParamBillions,
  resolveLocalToolSupport,
} from "./local-tool-tier";
export type { LocalToolSupport } from "./local-tool-tier";

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
   * 하네스 tool-use 적합성. 카드 배지·스폰 분기(대화모드 / 경량 주입 / 전체 주입)의
   * 단일 소스. 기본은 `resolveLocalToolSupport` 가 id 파라미터 규모로 채우고,
   * 크기로 판단이 안 되는 행만 명시 override 로 덮는다.
   */
  toolSupport: LocalToolSupport;
  /**
   * UI 배지 문구 — "대화·업무 분배" / "도구 사용 가능(경량 주입)" /
   * "도구 사용 가능(대형 모델)".
   */
  toolSupportLabel: string;
  /**
   * 크기 규칙을 명시 override 한 행만 채워지는 근거. 규칙대로면 undefined.
   *
   * ★근거를 데이터에 남기는 이유: override 는 "왜 이 모델만 예외인가"가 코드에서
   * 사라지는 순간 아무도 되돌리지 못하는 부채가 된다. 타입이 근거를 강제한다
   * (`buildLocalCatalogEntry` 의 입력 유니온 참조).
   */
  toolSupportOverrideReason?: string;
}

/** 카탈로그 행의 크기 규칙 부분 — toolSupport 계열은 팩토리가 채운다. */
type LocalCatalogBase = Omit<
  LocalModelCatalogEntry,
  "toolSupport" | "toolSupportLabel" | "toolSupportOverrideReason"
>;

/**
 * ★개별 모델 toolSupport override.
 *
 * 크기만으로는 판단이 안 되는 행이 실재한다 — 코더 특화 모델(devstral 24b,
 * codestral 22b)은 같은 규모의 범용 모델보다 도구 호출 포맷을 잘 지키는 반면,
 * 비전/MoE 계열은 파라미터 수가 실효 활성 파라미터와 다르다. 그래서 규칙을
 * 고치는 대신 행 단위로 덮을 수 있어야 한다.
 *
 * ★근거(`toolSupportOverrideReason`)를 **타입으로 강제**한다. 근거 없는 예외는
 * 6개월 뒤 아무도 못 건드리는 상수가 된다.
 */
interface LocalToolSupportOverride {
  toolSupport: LocalToolSupport;
  toolSupportOverrideReason: string;
}

type LocalCatalogInput = LocalCatalogBase &
  (
    | LocalToolSupportOverride
    | { toolSupport?: undefined; toolSupportOverrideReason?: undefined }
  );

/**
 * 카탈로그 행 하나를 만든다. override 가 없으면 id 규모 규칙(`resolveLocalToolSupport`),
 * 있으면 그 값을 그대로 쓰고 근거를 행에 남긴다.
 *
 * 테스트에서 override 경로를 직접 검증할 수 있도록 export 한다.
 */
export function buildLocalCatalogEntry(
  entry: LocalCatalogInput,
): LocalModelCatalogEntry {
  const { toolSupport: override, toolSupportOverrideReason, ...rest } = entry;
  const toolSupport = override ?? resolveLocalToolSupport(rest.id);
  return {
    ...rest,
    toolSupport,
    toolSupportLabel: localToolSupportLabel(toolSupport),
    ...(override ? { toolSupportOverrideReason } : {}),
  };
}

/** 카탈로그 리터럴용 짧은 별칭 — 아래 표가 한 줄이라도 좁아지게. */
const withToolSupport = buildLocalCatalogEntry;

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
    // 크기 규칙(24B < 25B)으로도 chat-only 지만, **명시 override 로 고정**한다.
    // #1036 에서 "devstral 24b 는 사장님 판단 위해 일단 chat-only 로" 결정됐다.
    // 코더 특화라 규모만으로는 판단이 안 되는 대표 케이스 — 실측이 나오면 이 두
    // 줄만 "tool-use-lite" 로 바꾸면 되고, 임계를 24B 로 내려 다른 24B 범용
    // 모델까지 끌어올리는 일이 없다.
    toolSupport: "chat-only",
    toolSupportOverrideReason:
      "#1036 — 코더 특화라 크기 규칙으로 판단 불가. 사장님 실측 전까지 chat-only 유지.",
  }),
  withToolSupport({
    id: "codestral:22b",
    displayName: "Codestral 22B",
    category: "coding",
    categoryLabel: "코딩 특화",
    downloadSizeMB: 13_000,
    minRamGB: 32,
    contextTokens: 32_000,
    toolSupport: "chat-only",
    toolSupportOverrideReason:
      "#1036 — devstral 과 같은 사유(코더 특화). 실측 전까지 chat-only 유지.",
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
    // ★태그 실측(ollama.com/library/qwen3.8/tags, 2026-08-20): `qwen3.8:27b`.
    // `qwen3:27b` 은 **존재하지 않는다** — qwen3 라이브러리는 0.6b/1.7b/14b/
    // 30b/32b/235b 뿐이고 27B 는 별도 라이브러리 `qwen3.8` 로 올라와 있다.
    // 없는 태그를 넣으면 dispatch 가 정상적으로 거부하므로 여기 값은 추측 금지.
    // ollama 모델 페이지가 `tools` capability 를 명시한다(vision/thinking 도).
    id: "qwen3.8:27b",
    displayName: "Qwen 3.8 27B (256K)",
    // 코딩 벤치가 높아 들여오지만 모델 자체는 범용(vision/thinking 포함)이다.
    // "코딩 특화" 버킷은 qwen2.5-coder/devstral/codestral 처럼 코드 전용 학습
    // 모델만 두는 자리라 사실대로 범용으로 둔다.
    category: "general",
    categoryLabel: "범용",
    // 태그 페이지 실측: 18GB / 256K context.
    downloadSizeMB: 18_000,
    // 큐레이션 기준을 gemma3:27b(17GB→48GB) 와 맞춘다. ★이 값은 신규 다운로드
    // 게이트일 뿐 설치분 실행을 막지 않는다 — 맥미니 실측 후 조정 가능.
    minRamGB: 48,
    contextTokens: 256_000,
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
 * 카탈로그 행이 있으면 그 toolSupport(= override 반영), 없으면 id 파라미터 규칙.
 * 카탈로그 밖 설치분(사용자가 직접 pull)도 같은 임계를 쓴다 — override 는
 * 카탈로그 행에만 달 수 있으므로 밖의 모델은 크기 규칙이 전부다.
 */
export function toolSupportForLocalModelId(id: string): LocalToolSupport {
  return catalogEntry(id)?.toolSupport ?? resolveLocalToolSupport(id);
}

/** 대화모드(MCP/내장 툴 비주입)로 스폰해야 하는 로컬 소형 모델인가. */
export function isLocalChatOnlyModel(id: string | undefined | null): boolean {
  if (!id || !id.trim()) return false;
  return isChatOnlyToolSupport(toolSupportForLocalModelId(id.trim()));
}

/** 경량 주입(도구는 주되 컨텍스트를 깎는) 티어로 스폰해야 하는 모델인가. */
export function isLocalToolUseLiteModel(
  id: string | undefined | null,
): boolean {
  if (!id || !id.trim()) return false;
  return toolSupportForLocalModelId(id.trim()) === "tool-use-lite";
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
