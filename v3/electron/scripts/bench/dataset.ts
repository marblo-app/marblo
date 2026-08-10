/**
 * SWE-bench 인스턴스 메타 취득.
 *
 * `datasets` 파이썬 라이브러리 없이 HuggingFace datasets-server REST 로 읽는다
 * — 이 하네스는 node 단독으로 돌아야 하고, 파이썬 의존을 하나라도 더 얹으면
 * 재실행 문턱이 올라간다.
 *
 * ★불변식: **커밋 SHA·테스트 id·패치는 오직 여기서만 나온다.** 매니페스트는
 * instance_id 만 고정하고, 나머지 필드를 사람이 옮겨 적는 것을 금지한다.
 * (이 하네스 개발 중 사람이 base_commit 뒷자리를 지어내 워크트리가 안 서는
 *  사고가 실제로 났다. 그 사고가 이 설계의 근거다.)
 */
import fs from "fs";
import path from "path";
import type { SweInstance } from "./types";
import { DATASET } from "./manifest";

const ROWS_PER_PAGE = 100;
/** Verified 는 500행 고정. 늘어나면 여기서 멈추지 말고 페이지를 더 돈다. */
const MAX_ROWS = 2000;

interface RawRow {
  row: Record<string, unknown>;
}

function asString(v: unknown, field: string, id: string): string {
  if (typeof v !== "string") {
    throw new Error(`instance ${id}: field ${field} is not a string`);
  }
  return v;
}

/**
 * 데이터셋의 F2P/P2P 는 **JSON 문자열로 인코딩된 배열**이다(리스트가 아니다).
 * 이걸 그냥 배열로 취급하면 조용히 문자 단위로 순회하게 된다.
 */
function parseTestList(v: unknown, field: string, id: string): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v !== "string") {
    throw new Error(`instance ${id}: field ${field} has unexpected type`);
  }
  const parsed: unknown = JSON.parse(v);
  if (!Array.isArray(parsed)) {
    throw new Error(
      `instance ${id}: field ${field} did not decode to an array`,
    );
  }
  return parsed.map(String);
}

function toInstance(row: Record<string, unknown>): SweInstance {
  const id = String(row.instance_id ?? "<unknown>");
  return {
    instance_id: id,
    repo: asString(row.repo, "repo", id),
    base_commit: asString(row.base_commit, "base_commit", id),
    environment_setup_commit: asString(
      row.environment_setup_commit,
      "environment_setup_commit",
      id,
    ),
    version: asString(row.version, "version", id),
    problem_statement: asString(row.problem_statement, "problem_statement", id),
    patch: asString(row.patch, "patch", id),
    test_patch: asString(row.test_patch, "test_patch", id),
    FAIL_TO_PASS: parseTestList(row.FAIL_TO_PASS, "FAIL_TO_PASS", id),
    PASS_TO_PASS: parseTestList(row.PASS_TO_PASS, "PASS_TO_PASS", id),
    difficulty: typeof row.difficulty === "string" ? row.difficulty : "",
  };
}

/** 캐시 경로. 네트워크가 끊긴 재실행에서도 같은 데이터로 돌게 한다. */
export function cachePath(rootDir: string): string {
  const safe = DATASET.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(rootDir, "dataset", `${safe}.json`);
}

/**
 * 데이터셋 전체를 받아 디스크에 캐시한다. 이미 캐시가 있으면 네트워크를 안 탄다
 * (`--refresh-dataset` 로 강제 갱신).
 */
export async function loadDataset(
  rootDir: string,
  refresh = false,
): Promise<Map<string, SweInstance>> {
  const file = cachePath(rootDir);
  if (!refresh && fs.existsSync(file)) {
    const cached: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (!Array.isArray(cached)) {
      throw new Error(`dataset cache at ${file} is corrupt (not an array)`);
    }
    return new Map(
      cached.map((r) => {
        const inst = toInstance(r as Record<string, unknown>);
        return [inst.instance_id, inst];
      }),
    );
  }

  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += ROWS_PER_PAGE) {
    const url =
      `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(DATASET)}` +
      `&config=default&split=test&offset=${offset}&length=${ROWS_PER_PAGE}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `datasets-server ${res.status} at offset ${offset} — ` +
          `데이터셋을 못 읽으면 벤치를 돌리면 안 된다(SHA 를 추측하게 되므로).`,
      );
    }
    const body = (await res.json()) as { rows?: RawRow[] };
    const page = body.rows ?? [];
    if (page.length === 0) break;
    for (const r of page) rows.push(r.row);
    if (page.length < ROWS_PER_PAGE) break;
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(rows));

  const map = new Map<string, SweInstance>();
  for (const r of rows) {
    const inst = toInstance(r);
    map.set(inst.instance_id, inst);
  }
  return map;
}

/**
 * test_patch 가 건드린 테스트 파일 목록. diff 의 `+++ b/<path>` 줄에서 뽑는다.
 * 러너에 넘길 지시자를 만드는 데 쓰고, **에이전트 실행 뒤 테스트 파일을
 * 되돌리는 데도** 쓴다(에이전트가 테스트를 고쳐 이기는 것을 막는다).
 */
export function testFilesFromPatch(testPatch: string): string[] {
  const files: string[] = [];
  for (const line of testPatch.split("\n")) {
    const m = /^\+\+\+ b\/(.+?)\s*$/.exec(line);
    if (m && m[1] !== "/dev/null") files.push(m[1]);
  }
  return [...new Set(files)];
}
