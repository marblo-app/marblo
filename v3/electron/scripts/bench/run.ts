/**
 * SWE-bench 자체 실측 러너 (P1 스파이크).
 *
 * ★목적: 벤더 공개치가 아니라 **우리가 우리 스폰 경로로 직접 잰** resolved 숫자를
 * 만든다. 표본이 tiny N 이라 랭킹용이 아니고, 파이프라인이 실제로 도는지와
 * 우리 배선에서 무엇이 관측되는지를 보기 위한 것이다.
 *
 * 사용법(레포 루트 v3/ 에서):
 *   npm run bench:swe -- --harness=gold                 # 무과금 자체검증
 *   npm run bench:swe -- --harness=claude               # ★실제 과금
 *   npm run bench:swe -- --harness=codex --effort=medium
 *   npm run bench:swe -- --harness=claude --instances=django__django-16642
 *   npm run bench:swe:report                            # 결과 → 마크다운 표
 *
 * ★`--harness=gold` 를 먼저 돌려라. gold 패치를 넣었을 때 resolved=1 이 안 나오면
 * 그건 모델 얘기가 아니라 **채점기가 고장 났다**는 뜻이고, 그 상태로 에이전트를
 * 태우면 토큰만 태우고 의미 없는 0% 를 얻는다.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { loadDataset, testFilesFromPatch } from "./dataset";
import {
  addWorktree,
  applyPatch,
  captureWorkingPatch,
  ensureBareRepo,
  removeWorktree,
  resetWorktree,
  restoreTestFiles,
  runTests,
  setupPythonEnv,
} from "./env";
import { parseTestLog } from "./logparse";
import {
  DATASET,
  EXEC_ENV_ID,
  GRADER_VERSION,
  REPO_SPECS,
  ROUNDS,
  scaffoldFor,
} from "./manifest";
import {
  buildInvocation,
  buildPrompt,
  cliVersion,
  providerFailure,
  runAgent,
} from "./agent";
import {
  benchVendorFor,
  startBenchVendorSession,
  type BenchVendorSession,
} from "./vendor";
import type { BenchHarness, Grade, RunRecord, TestStatusMap } from "./types";

interface Options {
  harness: BenchHarness;
  /** ★사전등록된 문제셋 선택. `a`=라운드A(12), `b`=라운드B(20, 해상도 상향). */
  round: "a" | "b";
  instances: string[];
  model: string | null;
  effort: string | null;
  root: string;
  out: string;
  keep: boolean;
  refreshDataset: boolean;
  agentTimeoutMs: number;
  testTimeoutMs: number;
  /** ★프로바이더 실패(429 등)일 때만 쓰는 시도 상한. 모델 실패는 재시도하지 않는다. */
  agentRetries: number;
  retryBackoffMs: number;
}

/** 백오프용. async main 안에서만 부르므로 타이머가 정상 동작한다. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv: string[]): Options {
  const get = (name: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };
  const root =
    get("root") ||
    process.env.MARBLO_BENCH_ROOT ||
    path.join(os.homedir(), ".marblo", "swe-bench");
  const harness = (get("harness") || "gold") as BenchHarness;
  if (!["gold", "claude", "codex", "grok", "noop"].includes(harness)) {
    throw new Error(`unknown --harness=${harness}`);
  }
  const roundArg = (get("round") || "a").toLowerCase();
  if (roundArg !== "a" && roundArg !== "b") {
    throw new Error(`unknown --round=${roundArg} (a|b)`);
  }
  const round = roundArg;
  const instancesArg = get("instances");
  return {
    harness,
    round,
    instances: instancesArg
      ? instancesArg.split(",").filter(Boolean)
      : [...ROUNDS[round]],
    model: get("model") || null,
    effort: get("effort") || null,
    root,
    out: get("out") || path.join(root, "results", "runs.jsonl"),
    keep: argv.includes("--keep"),
    refreshDataset: argv.includes("--refresh-dataset"),
    agentTimeoutMs: Number(get("agent-timeout") || 900) * 1000,
    testTimeoutMs: Number(get("test-timeout") || 1800) * 1000,
    agentRetries: Number(get("agent-retries") || 2),
    retryBackoffMs: Number(get("retry-backoff") || 90) * 1000,
  };
}

/**
 * ★채점 기준은 공식과 동일하다: **F2P 전부 통과 ∧ P2P 전부 통과**.
 * 부분점수를 주지 않는다 — 부분점수를 주는 순간 우리 숫자는 어떤 공개 수치와도
 * 대응하지 않는 자체 발명 지표가 된다.
 */
function grade(status: TestStatusMap, f2p: string[], p2p: string[]): Grade {
  const passed = (t: string): boolean => status[t] === "PASSED";
  const missing = [
    ...f2p.filter((t) => !passed(t)),
    ...p2p.filter((t) => !passed(t)),
  ];
  const f2pPassed = f2p.filter(passed).length;
  const p2pPassed = p2p.filter(passed).length;
  return {
    resolved: f2pPassed === f2p.length && p2pPassed === p2p.length,
    f2pPassed,
    f2pTotal: f2p.length,
    p2pPassed,
    p2pTotal: p2p.length,
    missing: missing.slice(0, 20),
  };
}

/**
 * ★조용한 오채점 방지 게이트.
 *
 * 러너는 멀쩡히 돌았는데 우리가 기대하는 테스트 id 가 로그에 **하나도** 없다면,
 * 그건 "모델이 못 고쳤다"가 아니라 **채점기가 로그를 못 읽고 있다**는 뜻이다.
 * 실제로 이 하네스 개발 중 django 4.2 인스턴스에서 정확히 그 일이 일어났고
 * (파이썬 버전에 따른 테스트 id 형식 차이 — `logparse.ts` 참조), 그때 결과는
 * "전부 통과했는데 resolved=false" 였다.
 *
 * 그런 런은 0% 로 기록되면 안 된다. **에러로 기록**돼서 분모 밖으로 나가고
 * 리포트에 별도로 보여야 한다.
 */
function assertIdsMatch(
  instanceId: string,
  status: TestStatusMap,
  f2p: string[],
  p2p: string[],
): void {
  const parsed = Object.keys(status);
  if (parsed.length === 0) {
    throw new Error(
      `${instanceId}: 테스트 로그에서 어떤 테스트 결과도 파싱하지 못했다. ` +
        `러너가 아예 못 떴을 가능성이 높다(test.log 확인).`,
    );
  }
  const expected = [...f2p, ...p2p];
  const hit = expected.filter((t) => t in status).length;
  if (hit === 0) {
    throw new Error(
      `${instanceId}: 테스트 ${parsed.length}개를 파싱했는데 데이터셋의 ` +
        `F2P/P2P id(${expected.length}개)와 **하나도** 겹치지 않는다. ` +
        `채점기 결함이지 모델 실패가 아니다 — id 형식(파이썬 버전)을 확인할 것.`,
    );
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}_${opts.harness}_r${opts.round}`;
  const startedAt = new Date().toISOString();

  console.log(`[bench] runId=${runId}`);
  console.log(`[bench] dataset=${DATASET}`);
  console.log(
    `[bench] harness=${opts.harness} model=${opts.model ?? "(cli default)"}`,
  );
  const scaffold = scaffoldFor(opts.round);
  console.log(`[bench] round=${opts.round} scaffold=${scaffold}`);
  console.log(`[bench] execEnv=${EXEC_ENV_ID}`);
  console.log(`[bench] instances=${opts.instances.join(", ")}`);

  const dataset = await loadDataset(opts.root, opts.refreshDataset);
  const version =
    opts.harness === "gold" || opts.harness === "noop"
      ? null
      : cliVersion(opts.harness);
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });

  // ★OpenAI 호환 env-swap 벤더(Upstage Solar)면 브리지 + 격리 CODEX_HOME 을
  // 런 묶음당 **한 번** 세운다. 키가 없으면 여기서 죽는다 — 조용히 기본 계정으로
  // 떨어져 "solar 라고 라벨된 남의 모델" 을 재는 것보다 안 도는 편이 낫다.
  const vendorSpec = benchVendorFor(opts.model);
  let vendor: BenchVendorSession | null = null;
  if (vendorSpec) {
    vendor = await startBenchVendorSession(
      vendorSpec,
      path.join(opts.root, "runs", runId),
      opts.model,
    );
    console.log(`[bench] vendorRoute=${vendor.route}`);
  }

  try {
    for (const instanceId of opts.instances) {
      const instance = dataset.get(instanceId);
      if (!instance) {
        throw new Error(
          `instance ${instanceId} not in ${DATASET} — 오타이거나 데이터셋이 바뀐 것이다.`,
        );
      }
      const spec = REPO_SPECS[instance.repo];
      if (!spec) {
        throw new Error(
          `no RepoSpec for ${instance.repo}. 새 레포를 추가하려면 manifest.ts 에 ` +
            `레시피를 넣고 --harness=gold 로 자체검증부터 통과시킬 것.`,
        );
      }

      const record: RunRecord = {
        label: "our-measured",
        runId,
        startedAt,
        dataset: DATASET,
        instanceId,
        repo: instance.repo,
        baseCommit: instance.base_commit,
        harness: opts.harness,
        model: opts.model,
        effort: opts.effort,
        scaffold,
        execEnv: EXEC_ENV_ID,
        graderVersion: GRADER_VERSION,
        cliVersion: version,
        vendorRoute: vendor?.route ?? null,
        agent: null,
        grade: null,
        error: null,
      };

      const workDir = path.join(opts.root, "runs", runId, instanceId);
      const repoDir = path.join(workDir, "repo");
      const venvDir = path.join(workDir, "venv");
      let bare = "";

      try {
        console.log(
          `\n[${instanceId}] base=${instance.base_commit.slice(0, 10)} (${instance.difficulty})`,
        );
        bare = ensureBareRepo(instance.repo, path.join(opts.root, "cache"));
        addWorktree(bare, instance.base_commit, repoDir);
        console.log(`[${instanceId}] building env (${spec.python}) …`);
        const python = setupPythonEnv(
          spec,
          repoDir,
          venvDir,
          opts.testTimeoutMs,
        );

        if (opts.harness === "gold") {
          // 자체검증: 정답 패치를 넣는다. resolved 가 1 이 아니면 채점기 결함.
          applyPatch(repoDir, instance.patch, "gold");
        } else if (opts.harness !== "noop") {
          const prompt = buildPrompt(instance);
          const invocation = buildInvocation(
            opts.harness,
            prompt,
            opts.model,
            opts.effort,
          );
          // ★프로바이더 실패(429 등)일 때**만** 다시 시도한다. 모델이 못 풀었을
          // 때는 절대 다시 돌리지 않는다 — 그건 표본을 유리하게 고르는 짓이다.
          // 재시도 사유는 codex 가 스스로 "포기했다" 고 적은 줄 하나로만 판정한다.
          let attempts = 0;
          let failure: string | null = null;
          for (;;) {
            attempts += 1;
            console.log(
              `[${instanceId}] spawning ${invocation.command} (attempt ${attempts}) …`,
            );
            const { run } = runAgent(
              invocation,
              repoDir,
              opts.agentTimeoutMs,
              vendor?.env ?? {},
            );
            record.agent = { ...run, patch: "", noOutput: true };
            record.agentAttempts = attempts;
            console.log(
              `[${instanceId}] agent exit=${run.exitCode} ${(run.durationMs / 1000).toFixed(0)}s` +
                (run.timedOut ? " (TIMED OUT)" : ""),
            );
            failure = providerFailure(run.tailLog);
            if (!failure) break;
            console.log(`[${instanceId}] ★provider failure: ${failure}`);
            if (attempts >= opts.agentRetries) break;
            console.log(
              `[${instanceId}] backing off ${(opts.retryBackoffMs / 1000).toFixed(0)}s …`,
            );
            await sleep(opts.retryBackoffMs);
            // 재시도는 깨끗한 트리에서 한다 — 앞 시도가 남긴 편집이 섞이면
            // "무엇을 잰 것인가" 가 흐려진다.
            resetWorktree(repoDir, instance.base_commit);
          }
          if (failure) {
            // ★채점하지 않는다. 모델이 답을 낸 적이 없는 런을 0점으로 적으면
            // 벤더 장애가 모델 실력으로 둔갑한다. 리포트는 이 행을 분모 밖
            // "에러" 로 따로 센다.
            throw new Error(
              `agent could not reach the provider after ${attempts} attempt(s): ${failure}`,
            );
          }
        }

        // ★테스트 파일 복구가 먼저다. 에이전트가 테스트를 고쳤다면 그 편집은
        // 채점 대상이 아니고, 되돌린 뒤에 남는 것이 실질 산출물이다.
        const testFiles = testFilesFromPatch(instance.test_patch);
        restoreTestFiles(repoDir, instance.base_commit, testFiles);

        if (record.agent) {
          const effective = captureWorkingPatch(repoDir);
          record.agent.patch = effective;
          record.agent.noOutput = effective.trim().length === 0;
          if (record.agent.noOutput)
            console.log(`[${instanceId}] ★no source output`);
        }

        applyPatch(repoDir, instance.test_patch, "test");
        const directives = testFiles.map(spec.toDirective);
        console.log(`[${instanceId}] running tests: ${directives.join(" ")}`);
        const testRun = runTests(
          spec,
          repoDir,
          python,
          directives,
          opts.testTimeoutMs,
        );
        const log = testRun.stdout + "\n" + testRun.stderr;
        fs.writeFileSync(path.join(workDir, "test.log"), log);

        const status = parseTestLog(spec.parser, log);
        assertIdsMatch(
          instanceId,
          status,
          instance.FAIL_TO_PASS,
          instance.PASS_TO_PASS,
        );
        record.grade = grade(
          status,
          instance.FAIL_TO_PASS,
          instance.PASS_TO_PASS,
        );
        console.log(
          `[${instanceId}] resolved=${record.grade.resolved} ` +
            `F2P ${record.grade.f2pPassed}/${record.grade.f2pTotal} ` +
            `P2P ${record.grade.p2pPassed}/${record.grade.p2pTotal}`,
        );
      } catch (err) {
        record.error = err instanceof Error ? err.message : String(err);
        console.error(`[${instanceId}] ERROR: ${record.error}`);
      } finally {
        fs.appendFileSync(opts.out, JSON.stringify(record) + "\n");
        if (!opts.keep && bare) removeWorktree(bare, repoDir);
        if (!opts.keep && fs.existsSync(venvDir)) {
          fs.rmSync(venvDir, { recursive: true, force: true });
        }
      }
    }
  } finally {
    if (vendor) await vendor.stop();
  }

  console.log(`\n[bench] results appended to ${opts.out}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
