/**
 * 모델 레지스트리 ↔ 실제 CLI 대조 런북 (라우팅 P1-5).
 *
 * `electron/model-registry.ts` 는 "CLI-verified 만 등록한다" 는 규율 위에 서 있는데,
 * CLI 는 우리가 손대지 않아도 업데이트로 바뀐다. 실제로 2026-07 에 alias `opus` 의
 * 의미가 opus-4.x → claude-opus-5 로 조용히 바뀌면서 표준작업 모델 세대가 아무도
 * 모르게 올라갔다(설계문서 §1.3-①). 이 스크립트는 그 부류의 드리프트를
 * **다음 사고 전에** 잡는 것이 목적이다.
 *
 * 검사 항목:
 *   [alias]     alias 가 여전히 레지스트리가 말하는 모델로 해석되는가 (★①번 결함 재발 감지)
 *   [id]        등록된 구체 id 를 CLI 가 실제로 서빙하는가
 *   [unlisted]  CLI/캐시엔 있는데 레지스트리에 없는 모델
 *   [effort]    codex 모델의 지원 effort·기본 effort 가 캐시와 일치하는가
 *   [mincli]    설치된 CLI 가 각 항목의 minCli 를 만족하는가(미달이면 폴백 중이라는 뜻)
 *   [pricing]   단가가 아직 추정치(estimated)로 남아 있는 항목
 *   [vendor]    env-swap 벤더(GLM 등) 크레덴셜이 설정됐는가 + 설정됐다면 라이브 대조
 *               (키 없으면 필요한 **env 키 이름**만 알려주고 skip — 값은 안 찍는다)
 *
 * 사용법:
 *   npm run verify:models              # 전체(claude 실프로브 포함 — 소액 토큰 과금)
 *   npm run verify:models -- --offline # 프로브 없이 캐시/정합성만(무과금)
 *   npm run verify:models -- --json    # 기계 판독용
 *
 * CI 에 넣지 않는다 — 모델 목록은 네트워크·계정 의존이라 CI 에선 플레이키해진다
 * (설계문서 §2 검증법). 수동 런북이 맞다.
 *
 * 종료코드: 불일치가 하나라도 있으면 1, 깨끗하면 0.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import {
  HARNESS_NATIVE_VENDOR,
  MODEL_REGISTRY,
  type EffortLevel,
  type ModelRegistryEntry,
  cmpSemver,
  getModel,
} from "../model-registry";
import {
  applyVendorEnv,
  resolveClaudeBinary,
  resolveHarnessCli,
  vendorEnvReadiness,
} from "../agent-config";

type Severity = "mismatch" | "warn" | "ok";

interface Finding {
  severity: Severity;
  check:
    | "alias"
    | "id"
    | "unlisted"
    | "effort"
    | "mincli"
    | "pricing"
    | "vendor";
  subject: string;
  detail: string;
}

const findings: Finding[] = [];
const add = (
  severity: Severity,
  check: Finding["check"],
  subject: string,
  detail: string,
): void => {
  findings.push({ severity, check, subject, detail });
};

// ─────────────────────────────────────────────────────────────────────────
// Claude — `--output-format json` 의 modelUsage 키가 실제 서빙 모델이다.
// 무효 id 는 is_error=true + modelUsage 공백으로 확실히 구분된다(설계문서 §1.1).
// ─────────────────────────────────────────────────────────────────────────

/**
 * 프로브 1회. 실제로 서빙된 모델 id 를 돌려준다(실패/무효면 null).
 *
 * ★중립 cwd(os.tmpdir())에서 돌린다. 프로젝트 디렉토리에서 돌리면 그 repo 의
 * MCP 서버 기동·디렉토리 신뢰 확인까지 딸려와 프로브가 몇 분씩 매달린다(실측).
 * 우리가 알고 싶은 건 "이 CLI 가 이 모델 id 를 무엇으로 해석하나" 뿐이라 프로젝트
 * 컨텍스트가 필요 없다 — 설계문서 §5 의 스킬 상속 실측도 같은 이유로 /tmp 에서 했다.
 */
function probeClaudeServedModel(
  command: string,
  requested: string,
  /** 벤더 프로파일 env(env-swap 벤더 행 검증용). 미지정이면 현재 env 그대로. */
  extraEnv?: Record<string, string>,
): string | null {
  try {
    const out = execFileSync(
      command,
      ["-p", "ok", "--model", requested, "--output-format", "json"],
      {
        encoding: "utf-8",
        cwd: os.tmpdir(),
        timeout: 120_000,
        maxBuffer: 8 * 1024 * 1024,
        ...(extraEnv ? { env: { ...process.env, ...extraEnv } } : {}),
      },
    );
    const parsed = JSON.parse(out) as {
      is_error?: boolean;
      modelUsage?: Record<string, unknown>;
    };
    if (parsed.is_error) return null;
    const keys = Object.keys(parsed.modelUsage ?? {});
    return keys.length ? keys[0] : null;
  } catch {
    // 비정상 종료(무효 모델 포함) — 프로브 실패로 취급.
    return null;
  }
}

function verifyClaude(offline: boolean): void {
  const cli = resolveClaudeBinary();
  const installed = cli.version || "unknown";
  console.log(`\n▸ claude CLI ${installed} (${cli.command})`);

  // ★하네스로 고르고 벤더로 한 번 더 좁힌다(USbdRV4k 축분리). 이 프로브는 **이
  // 머신의 claude 로그인**으로 도는 것이라, 같은 harness 라도 env-swap 벤더
  // (provider=zai 등)는 여기서 검증할 수 없다 — 그 행의 검증은 자기 프로파일 env
  // 를 얹은 별도 경로가 필요하다(벤더 편입 티켓).
  const entries = MODEL_REGISTRY.filter(
    (m) => m.harness === "claude" && m.provider === "anthropic",
  );
  checkMinCli(entries, cli.version);

  if (offline) {
    console.log("  (--offline: 실프로브 생략)");
    return;
  }
  if (!cli.version) {
    add("warn", "id", "claude", "claude CLI 를 못 찾아 프로브를 건너뛴다");
    return;
  }

  for (const entry of entries) {
    // ① 구체 id 가 실제로 서빙되는가.
    const servedById = probeClaudeServedModel(cli.command, entry.id);
    if (servedById === null) {
      add(
        "mismatch",
        "id",
        entry.id,
        "레지스트리에 있으나 CLI 가 서빙하지 못했다(무효 id 이거나 계정 미허용)",
      );
    } else if (servedById !== entry.id) {
      add(
        "mismatch",
        "id",
        entry.id,
        `요청한 id 와 서빙된 모델이 다르다 → ${servedById}`,
      );
    } else {
      console.log(`  ✓ id     ${entry.id}`);
    }

    // ② ★alias 드리프트 — 이 검사가 이 스크립트의 존재 이유다.
    for (const alias of entry.aliases) {
      const servedByAlias = probeClaudeServedModel(cli.command, alias);
      if (servedByAlias === null) {
        add("warn", "alias", alias, "alias 프로브 실패(서빙 확인 불가)");
      } else if (servedByAlias !== entry.id) {
        add(
          "mismatch",
          "alias",
          alias,
          `alias 의미가 바뀌었다: 레지스트리는 ${entry.id} 라 하는데 CLI 는 ${servedByAlias} 를 서빙한다. ` +
            `→ model-registry.ts 의 aliases 를 갱신하고, 이 alias 를 핀으로 쓰는 자리가 없는지 확인할 것`,
        );
      } else {
        console.log(`  ✓ alias  ${alias} → ${entry.id}`);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Codex — 권위 목록은 서버에서 받아 캐시된 ~/.codex/models_cache.json 이다.
// 프로브가 아니라 캐시 대조라 무과금이고, --offline 여부와 무관하게 돈다.
// ─────────────────────────────────────────────────────────────────────────

interface CodexCacheModel {
  slug?: string;
  default_reasoning_effort?: string;
  supported_reasoning_efforts?: string[];
}

function readCodexCache(): CodexCacheModel[] | null {
  const file = path.join(os.homedir(), ".codex", "models_cache.json");
  if (!fs.existsSync(file)) return null;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
    // 캐시 스키마는 코덱스 버전마다 흔들린다 — 배열이든 {models:[...]} 든 받는다.
    const list = Array.isArray(parsed)
      ? parsed
      : ((parsed as { models?: unknown })?.models ?? null);
    return Array.isArray(list) ? (list as CodexCacheModel[]) : null;
  } catch {
    return null;
  }
}

function verifyCodex(): void {
  const cli = resolveHarnessCli("gpt");
  console.log(`\n▸ codex CLI ${cli.version || "unknown"} (${cli.command})`);

  // 하네스 gpt + 벤더 openai 만. (사유는 verifyClaude 주석과 동일.)
  const entries = MODEL_REGISTRY.filter(
    (m) => m.harness === "gpt" && m.provider === "openai",
  );
  checkMinCli(entries, cli.version);

  const cache = readCodexCache();
  if (!cache) {
    add(
      "warn",
      "id",
      "codex",
      "~/.codex/models_cache.json 을 읽지 못했다(미설치이거나 스키마 변경). codex 항목 대조 생략",
    );
    return;
  }

  const bySlug = new Map<string, CodexCacheModel>();
  for (const m of cache) if (m.slug) bySlug.set(m.slug, m);

  for (const entry of entries) {
    const cached = bySlug.get(entry.id);
    if (!cached) {
      add(
        "mismatch",
        "id",
        entry.id,
        "레지스트리에 있으나 codex 권위 목록엔 없다(제거됐거나 이름이 바뀌었다)",
      );
      continue;
    }
    console.log(`  ✓ id     ${entry.id}`);

    const cachedEfforts = (cached.supported_reasoning_efforts ?? []).map((e) =>
      e.toLowerCase(),
    );
    if (cachedEfforts.length) {
      const missing = cachedEfforts.filter(
        (e) => !entry.efforts.includes(e as EffortLevel),
      );
      const extra = entry.efforts.filter((e) => !cachedEfforts.includes(e));
      if (missing.length || extra.length) {
        add(
          "mismatch",
          "effort",
          entry.id,
          `지원 effort 불일치 — 캐시=[${cachedEfforts.join(",")}] 레지스트리=[${entry.efforts.join(",")}]`,
        );
      }
    }
    const cachedDefault = cached.default_reasoning_effort?.toLowerCase();
    if (cachedDefault && cachedDefault !== entry.defaultEffort) {
      add(
        "mismatch",
        "effort",
        entry.id,
        `기본 effort 불일치 — 캐시=${cachedDefault} 레지스트리=${entry.defaultEffort ?? "(없음)"}`,
      );
    }
  }

  // 캐시엔 있는데 우리가 모르는 모델. 의도적 미등록(api ✗ / hidden)이 있으므로
  // warn 으로만 띄운다 — 판단은 사람이 한다.
  for (const slug of bySlug.keys()) {
    if (!getModel(slug)) {
      add(
        "warn",
        "unlisted",
        slug,
        "codex 목록엔 있으나 레지스트리에 없다(의도적 미등록일 수 있음 — model-registry.ts 하단 주석 확인)",
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────
// env-swap 벤더(provider ≠ 하네스 네이티브 벤더 — GLM 등)
//
// 이 행들은 **이 머신의 claude 로그인으로는 검증할 수 없다**. 검증하려면 그 벤더의
// 구독키가 필요하고, 키는 레지스트리가 아니라 env(`v3/.env`)에 있다. 그래서:
//   키 없음 → 무엇을 넣어야 켜지는지 **키 이름만** 알려주고 프로브 skip(무과금)
//   키 있음 → 그 프로파일 env 를 얹어 실제 프로브(그 벤더 쿼터를 1프롬프트 소모)
// ★어느 쪽이든 시크릿 **값**은 출력하지 않는다.
//
// ★이 스크립트는 순수 node 로 돈다 — 앱 설정 UI 가 등록한 키(OS 키체인 암호화,
// `vendor-secrets`)는 Electron 밖에서 복호화할 수 없으므로 여기서는 **보이지 않는다**.
// 그래서 "앱에선 켜져 있는데 여기선 미설정" 이 정상 조합이고, 아래 안내가 두 경로를
// 모두 말해준다(앱에서 켠 것을 이 스크립트로 라이브 프로브하려면 같은 키를 `v3/.env`
// 에도 넣어야 한다).
// ─────────────────────────────────────────────────────────────────────────

function verifyVendorProfiles(offline: boolean): void {
  const entries = MODEL_REGISTRY.filter(
    (m) => m.envProfile && m.provider !== HARNESS_NATIVE_VENDOR[m.harness],
  );
  if (entries.length === 0) return;

  console.log(`\n▸ env-swap 벤더 프로파일 ${entries.length}행`);
  const cli = resolveClaudeBinary();

  for (const entry of entries) {
    const readiness = vendorEnvReadiness(entry.id);
    const need = readiness.requiredEnvKeys.join(", ") || "(시크릿 없음)";
    if (!readiness.ready) {
      add(
        "warn",
        "vendor",
        entry.id,
        `${entry.provider} 크레덴셜 미설정(이 프로세스 기준) — 라이브 검증 skip. ` +
          `필요한 env(값 아님): ${readiness.missingEnvKeys.join(", ")}. ` +
          `앱에서 쓰려면 설정 → API 키 → "벤더 API 키" 에 등록하고, ` +
          `이 스크립트로 라이브 프로브까지 하려면 v3/.env 에도 넣고 재실행하세요`,
      );
      continue;
    }
    console.log(`  ✓ env    ${entry.id} — ${need} 설정됨`);

    if (offline) continue;
    if (entry.harness !== "claude" || !cli.version) {
      add(
        "warn",
        "vendor",
        entry.id,
        `harness=${entry.harness} 프로브 경로가 아직 없다(또는 CLI 미검출) — 라이브 대조 생략`,
      );
      continue;
    }
    // 프로파일을 얹은 env 로 프로브. `--model` 은 우리 스폰 경로와 같은 값이다.
    const profileEnv = applyVendorEnv({}, entry.id);
    const served = probeClaudeServedModel(cli.command, entry.id, profileEnv);
    if (served === null) {
      add(
        "warn",
        "vendor",
        entry.id,
        `${entry.provider} 엔드포인트가 이 id 를 서빙하지 못했다(키 만료·플랜 미포함·id 변경 중 하나). ` +
          "구독 상태를 먼저 확인할 것",
      );
    } else if (served !== entry.id) {
      // ★mismatch 가 아니라 warn 이다: 벤더가 응답에 어떤 모델명을 담는지 우리가
      // 아직 라이브로 본 적이 없다(구독키 미보유). 첫 라이브 실행에서 사람이
      // 판정하고, 그때 이 severity 를 확정한다.
      add(
        "warn",
        "vendor",
        entry.id,
        `요청 id 와 응답 모델명이 다르다 → ${served}. 벤더 응답 규약 확인 후 레지스트리/이 검사 확정`,
      );
    } else {
      console.log(`  ✓ live   ${entry.id} (${entry.provider})`);
    }
  }
}

/** 설치된 CLI 가 각 항목의 minCli 를 만족하는가. 미달 = 지금 폴백 중이라는 뜻. */
function checkMinCli(
  entries: readonly ModelRegistryEntry[],
  installed: string,
): void {
  for (const entry of entries) {
    if (!entry.minCli) continue;
    if (!installed) {
      add(
        "warn",
        "mincli",
        entry.id,
        `CLI 버전을 감지하지 못했다 — minCli ${entry.minCli} 검증 불가(안전 폴백 중)`,
      );
    } else if (cmpSemver(installed, entry.minCli) < 0) {
      add(
        "warn",
        "mincli",
        entry.id,
        `설치 CLI ${installed} < minCli ${entry.minCli} — 이 모델은 현재 alias 로 폴백되고 있다`,
      );
    }
  }
}

/** 단가가 아직 추정치인 항목 — 확정 전까진 비용대비효과 결론을 믿으면 안 된다. */
function checkEstimatedPricing(): void {
  for (const entry of MODEL_REGISTRY) {
    if (entry.pricing.estimated) {
      add(
        "warn",
        "pricing",
        entry.id,
        `단가가 보수적 추정치다($${entry.pricing.inputPer1M}/$${entry.pricing.outputPer1M}) — 공식 단가로 확정 필요`,
      );
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const offline = args.includes("--offline");
  const asJson = args.includes("--json");

  if (!asJson) {
    console.log(
      `모델 레지스트리 대조 — ${MODEL_REGISTRY.length}개 항목${offline ? " (offline)" : ""}`,
    );
  }

  verifyClaude(offline);
  verifyCodex();
  verifyVendorProfiles(offline);
  checkEstimatedPricing();

  const mismatches = findings.filter((f) => f.severity === "mismatch");
  const warns = findings.filter((f) => f.severity === "warn");

  if (asJson) {
    console.log(
      JSON.stringify({ findings, mismatches: mismatches.length }, null, 2),
    );
  } else {
    if (warns.length) {
      console.log(`\n▸ 경고 ${warns.length}건`);
      for (const f of warns)
        console.log(`  · [${f.check}] ${f.subject}: ${f.detail}`);
    }
    if (mismatches.length) {
      console.log(`\n▸ ★불일치 ${mismatches.length}건 — 레지스트리 갱신 필요`);
      for (const f of mismatches)
        console.log(`  ✗ [${f.check}] ${f.subject}: ${f.detail}`);
    } else {
      console.log("\n▸ 불일치 없음 — 레지스트리가 실제 CLI 와 일치한다");
    }
  }

  process.exit(mismatches.length ? 1 : 0);
}

void main();
