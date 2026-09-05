/**
 * 문구 사전 테스트 — ★로케일 세 벌이 **전부** 완결돼 있는지 본다.
 *
 * 폴백(영어)이 있으니 키가 빠져도 화면은 안 깨지지만, 그건 사고 방지책이지
 * 번역 누락을 눈감아 주는 장치가 아니다. CI 가 죽어 있으므로 이 테스트가
 * 그 자리를 대신한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import ko from "../../../../messages/ko.json";
import en from "../../../../messages/en.json";
import ja from "../../../../messages/ja.json";
import {
  TEAM_COPY_KEYS,
  buildTeamCopy,
  fill,
  missingTeamCopyKeys,
} from "./teamCopy";

const LOCALES: Array<[string, unknown]> = [
  ["ko", ko.team],
  ["en", en.team],
  ["ja", ja.team],
];

for (const [locale, block] of LOCALES) {
  test(`[${locale}] team 문구가 한 키도 빠지지 않는다`, () => {
    assert.deepEqual(missingTeamCopyKeys(block), []);
  });

  test(`[${locale}] 빈 문자열로 채워 놓은 키가 없다`, () => {
    const copy = buildTeamCopy(block);
    for (const key of TEAM_COPY_KEYS) {
      assert.ok(copy.text[key].trim() !== "", `${key} 가 비어 있다`);
    }
  });

  test(`[${locale}] 사유 사전과 willShow 가 채워져 있다`, () => {
    const copy = buildTeamCopy(block);
    assert.ok(Object.keys(copy.reasons).length >= 4);
    assert.ok(copy.willShow.length >= 3);
  });
}

test("세 로케일의 사유 코드 집합이 같다 — 코드마다 세 벌이 있어야 한다", () => {
  const sets = LOCALES.map(([, block]) =>
    Object.keys(buildTeamCopy(block).reasons).sort()
  );
  assert.deepEqual(sets[1], sets[0]);
  assert.deepEqual(sets[2], sets[0]);
});

test("자리표시자가 세 로케일에서 같은 이름을 쓴다", () => {
  const placeholders = (s: string) =>
    (s.match(/\{(\w+)\}/g) ?? []).sort().join(",");
  const copies = LOCALES.map(([, block]) => buildTeamCopy(block));
  for (const key of TEAM_COPY_KEYS) {
    const a = placeholders(copies[0].text[key]);
    assert.equal(placeholders(copies[1].text[key]), a, `${key} (en)`);
    assert.equal(placeholders(copies[2].text[key]), a, `${key} (ja)`);
  }
});

test("깨진 입력에도 폴백으로 완결된 사전이 나온다", () => {
  const bads: unknown[] = [undefined, null, 42, "nope", [], { team: {} }];
  for (const bad of bads) {
    const copy = buildTeamCopy(bad);
    for (const key of TEAM_COPY_KEYS) {
      assert.ok(copy.text[key].trim() !== "", `${key} (input=${String(bad)})`);
    }
    assert.ok(copy.willShow.length > 0);
  }
});

// ── ★운영자 낱말 스캐너 ────────────────────────────────────────────────────
//
// 이 화면을 읽는 사람은 오너지 엔지니어가 아니다. 그런데 문구를 서버 원문에서
// 옮겨 오다 보면 필드명·컬렉션명·툴 이름이 그대로 따라온다 — "저장소 로컬
// 경로(repoRoot)" 처럼. 문장은 **참인데 독자가 틀린** 실패라 리뷰로는 잘 안 잡힌다.
// (백엔드 쪽에도 같은 검사가 있다: `teamAudit.findOperatorOnlyText`.)
//
// ★★이 검사가 **못 하는 일**을 먼저 적는다. 검사가 있으면 사람은 그 자리를
//   안 보게 되고, 그 착각이 검사의 값보다 비쌀 수 있다.
//
//   아래 검사가 잡는 것은 **"이 낱말이 구현 어휘인가"** 하나뿐이다.
//   잡지 못하는 것: **"이 문장을 읽은 사람이 다음에 무엇을 할까."**
//
//   실제 사례. `note_member_key_unavailable` 이 "서버 설정 문제로 …" 였다.
//   `서버` 를 빼면 이 검사는 통과한다 — 그런데 "설정 문제로 …" 로 줄이면
//   **오너가 자기 설정을 뒤지러 간다.** 낱말은 깨끗해졌는데 문장은 더 나빠진 것이다.
//   답은 원인을 말하지 않고 "문제가 계속되면 지원팀에 알려 주세요" 로 끝내는
//   것이었고, **그 판단은 어떤 정규식도 대신해 주지 못한다.**
//
//   → 문구를 고칠 때마다 사람이 따로 물어야 한다: 이 문장을 읽은 오너가
//     **할 수 있는 일**이 있나, 없다면 그 사실이 문장에 들어 있나.

const OPERATOR_PATTERNS: Array<[string, RegExp]> = [
  // account_ledger · merge_history · TEAM_USAGE_EFFECTIVE_FROM · spawn_agent …
  ["snake_case 식별자", /[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+/],
  // repoRoot · instructionRedacted · totalCost · projectId …
  ["camelCase 식별자", /\b[a-z]+[A-Z][A-Za-z0-9]*\b/],
  ["소스 파일명", /\b[\w./-]+\.(ts|tsx|json|js)\b/],
  [
    "운영자 낱말",
    /\b(params|uid|env|callable|Firestore|BigQuery|schema|payload|endpoint|ledger|agent-id)\b/i,
  ],
  // ★설계·구현 어휘 — 오너에게는 아무 뜻도 없다.
  //   `server` 는 처음엔 뺐었다(백엔드 원문이 쓰고 있어서, 번역본만 다르게 쓰면
  //   같은 사실이 두 벌로 갈라진다). 백엔드가 자기 문장 둘에서 걷어냈으므로
  //   이제 넣는다 — 양쪽 검사가 같이 지킨다.
  ["설계·구현 어휘", /\b(axis|contract|envelope|response|server)\b/i],
];

/**
 * ko·ja 구현 어휘. ★라틴 규칙이 못 잡는 자리다 — 한글·가나로 쓰면 통과한다.
 * 백엔드도 원문 쪽에 같은 목록을 쓴다.
 *
 * ★목록을 좁게 잡는다. `응답`·`요청`·`필드` 는 오너 문장에서도 자연스러울 수
 * 있어 넣지 않았다 — 넓은 검사는 멀쩡한 문장을 사람 손으로 고치게 만든다.
 */
const CJK_IMPL_PATTERNS: Array<[string, RegExp]> = [
  ["ko 구현 어휘", /서버|클라이언트|콜러블|엔드포인트|스키마|쿼리|인덱스|캐시/g],
  [
    "ja 구현 어휘",
    /サーバー|クライアント|エンドポイント|スキーマ|クエリ|インデックス|キャッシュ/g,
  ],
];

/**
 * ★낱말별 예외가 아니라 **키별** 예외다.
 *
 * '캐시 읽기/쓰기 토큰' 은 구현 어휘가 아니라 **오너가 실제로 보는 지표**다
 * (설계 §2 Q9 "캐시 히트로 얼마 아꼈나"). 그렇다고 `캐시` 를 목록에서 빼면
 * "캐시 미스 경로" 같은 진짜 유출이 그냥 통과한다. 그래서 이 세 자리에서만 연다.
 */
const CJK_IMPL_EXCEPTIONS: Readonly<Record<string, readonly string[]>> = {
  "캐시": ["cache.hit", "totals.cacheRead", "totals.cacheWrite"],
  "キャッシュ": ["cache.hit", "totals.cacheRead", "totals.cacheWrite"],
};

for (const [locale, block] of LOCALES) {
  if (locale === "en") continue;
  test(`[${locale}] 사용자 문장에 구현 어휘가 없다`, () => {
    const hits: string[] = [];
    for (const [path, text] of userFacingStrings(block)) {
      for (const [label, re] of CJK_IMPL_PATTERNS) {
        for (const m of text.matchAll(re)) {
          const allowed = CJK_IMPL_EXCEPTIONS[m[0]] ?? [];
          if (!allowed.includes(path)) hits.push(`${path}: ${label} "${m[0]}"`);
        }
      }
    }
    assert.deepEqual(hits, [], hits.join("\n"));
  });
}

test("구현 어휘 예외가 실제로 그 자리에만 열려 있다", () => {
  // ★위양성 짝. 예외 목록이 낱말 단위로 잘못 열려 있으면, 다른 자리에 같은
  //   낱말을 넣어도 통과한다 — 그러면 이 검사는 살아 있는 척만 하는 것이다.
  const copy = buildTeamCopy(ko.team);
  assert.ok(copy.text["cache.hit"].includes("캐시"), "미끼가 성립해야 한다");
  const allowed = CJK_IMPL_EXCEPTIONS["캐시"] ?? [];
  assert.ok(allowed.includes("cache.hit"));
  assert.ok(!allowed.includes("cell.pendingBody"), "예외는 좁아야 한다");
});

/** 화면에 그려지는 문자열 전부를 훑는다. `basisValues` 의 **키**는 서버 값이라 제외. */
function userFacingStrings(block: unknown): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (node: unknown, path: string) => {
    if (typeof node === "string") {
      out.push([path, node]);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        walk(v, path ? `${path}.${k}` : k);
      }
    }
  };
  walk(block, "");
  // basisValues 는 키가 서버 값(account_ledger)이라 경로째 뺀다 — 값만 사람 말이다.
  return out.filter(([path]) => !path.startsWith("basisValues"));
}

for (const [locale, block] of LOCALES) {
  test(`[${locale}] 사용자 문장에 운영자 낱말이 없다`, () => {
    const hits: string[] = [];
    for (const [path, text] of userFacingStrings(block)) {
      for (const [label, re] of OPERATOR_PATTERNS) {
        const m = text.match(re);
        if (m) hits.push(`${path}: ${label} "${m[0]}"`);
      }
    }
    assert.deepEqual(hits, [], hits.join("\n"));
  });
}

// ── ★라틴 낱말 규칙 (ko·ja 전용) ───────────────────────────────────────────
//
// 위의 패턴 목록은 **아는 모양만** 잡는다. `criteria` · `basis` · `withheld`
// 처럼 **평범한 영어 단어인 필드명**은 snake_case 도 camelCase 도 아니라 영원히
// 안 걸린다. 그래서 목록을 늘리는 대신 **문자 종류로** 막는다:
//   한국어·일본어 문장에 라틴 낱말이 2자 이상 나오면 실패.
// 새 필드명이 무엇이 되든 걸리고, 허용은 아래 목록에 **명시적으로** 적어야 한다
// (fail-closed). 백엔드도 원문 쪽에 같은 규칙을 쓴다.

/**
 * ko·ja 사용자 문장에 남겨도 되는 라틴 낱말.
 * ★한 줄 늘릴 때마다 "이건 오너가 읽는 말인가" 를 답해야 한다.
 */
const ALLOWED_LATIN_IN_CJK = new Set([
  // 깃허브 PR 번호 라벨. 한국어·일본어 개발 문맥에서 그대로 쓰는 말이다.
  "PR",
]);

for (const [locale, block] of LOCALES) {
  if (locale === "en") continue;
  test(`[${locale}] 사용자 문장에 허용되지 않은 라틴 낱말이 없다`, () => {
    const hits: string[] = [];
    for (const [path, text] of userFacingStrings(block)) {
      // 자리표시자(`{hours}`)는 문구가 아니라 치환 지점이다.
      const stripped = text.replace(/\{\w+\}/g, "");
      for (const m of stripped.matchAll(/[A-Za-z]{2,}/g)) {
        if (!ALLOWED_LATIN_IN_CJK.has(m[0])) hits.push(`${path}: "${m[0]}"`);
      }
    }
    assert.deepEqual(hits, [], hits.join("\n"));
  });
}

// ── ★en 은 인벤토리로 막는다 ────────────────────────────────────────────────
//
// 라틴 규칙은 en 에 쓸 수 없다. 그리고 패턴 목록은 `criteria`·`basis` 처럼
// **평범한 영어 단어인 필드명**을 영원히 못 잡는다 — 모양을 추측하기 때문이다.
// 그래서 en 만은 **모양이 아니라 인벤토리**로 본다: 서버가 "응답에 들어오면 안
// 된다" 고 세어 둔 이름과 MCP 툴 이름 전량에 대조한다.
//
// ★출처: `v3/functions/src/teamAudit.ts` 의 `FORBIDDEN_RESPONSE_KEYS` +
//   `PROJECT_EVENT_TOOLS`. 아래는 그 사본이고, 원본이 이 저장소에 들어오면
//   `드리프트` 테스트가 사본이 낡았는지 확인한다.
const SERVER_INVENTORY: readonly string[] = [
  // 자유 텍스트 계열
  "params", "instruction", "instructionRedacted", "instructionHash",
  "result", "message", "text", "goal",
  // 경로 계열
  "repoRoot", "folderPath", "folderPaths", "worktreeId",
  // 금액·토큰 계열
  "totalCost", "costUsd", "cost", "inputTokens", "outputTokens", "tokens",
  // 원시 식별자 계열
  "actorUid", "uid", "userId", "ownerId", "email", "displayName", "members",
  // MCP 툴 이름 (PROJECT_EVENT_TOOLS)
  "create_task", "create_tasks_bulk", "claim_task", "update_task_status",
  "submit_for_review", "merge_and_close", "spawn_agent", "create_flow",
  "update_flow",
];

/**
 * ★인벤토리 낱말 중 **평범한 영어이기도 한** 것 — 사람이 분류를 마친 목록.
 *
 * `"estimated usage cost"` 의 `cost` 는 필드 이름이 아니라 낱말이다. 자동으로는
 * 못 가르므로 사람이 한 번 보고 여기 적는다 — `PR` 허용 목록과 같은 구조다.
 *
 * ★**지금 문구에 없는 낱말도 미리 적는다.** 처음엔 "등장하는 것만" 적었는데,
 *   그러면 `message`·`text` 처럼 UI 문구에 아주 흔한 낱말이 **아무도 안 본 채로**
 *   목록 밖에 남는다. 나중에 누가 "no message" 라고 쓰면 그때서야 빨간불이 뜨고,
 *   급한 사람은 판단 없이 목록에 밀어 넣는다. 미리 분류해 두면 그 순간이 없다.
 *   (백엔드가 짚어 준 "죽은 낱말 검사의 반대편 구멍".)
 */
const PLAIN_ENGLISH_INVENTORY = new Set([
  "cost", // "estimated usage cost"
  "tokens", // "cache read tokens"
  "members", // "invite members to the project"
  "email", // "looked like an email address"
  "instruction", // "the instructions given to an agent"
  "goal", // "the goal written on a mission"
  "result", // "it is not that the result measured zero"
  "message", // UI 문구에서 흔하다("no message") — 필드 참조와 못 가른다
  "text", // 같은 이유
]);

function enStrings(): Array<[string, string]> {
  return userFacingStrings(en.team);
}

test("[en] 서버 인벤토리 낱말이 문구에 새어 들어오지 않는다", () => {
  const hits: string[] = [];
  for (const word of SERVER_INVENTORY) {
    if (PLAIN_ENGLISH_INVENTORY.has(word)) continue;
    const re = new RegExp(`\\b${word}\\b`, "i");
    for (const [path, text] of enStrings()) {
      if (re.test(text)) hits.push(`${path}: "${word}"`);
    }
  }
  assert.deepEqual(hits, [], hits.join("\n"));
});

test("[en] 분류 목록에 인벤토리 밖 낱말이 없다", () => {
  // ★낡음 검사의 방향을 바꿨다. "문구에 아직 있나" 가 아니라 "인벤토리에 아직
  //   있나" 를 본다 — 백엔드가 키를 지우면 이 분류도 의미를 잃기 때문이다.
  //   문구 등장 여부로 검사하면, 아직 안 쓴 낱말을 미리 분류해 둘 수가 없다.
  const orphan = [...PLAIN_ENGLISH_INVENTORY].filter(
    (w) => !SERVER_INVENTORY.includes(w)
  );
  assert.deepEqual(orphan, [], `인벤토리에 없는 낱말: ${orphan.join(", ")}`);
});

test("인벤토리 사본이 서버 원본과 어긋나지 않는다 (원본이 있을 때만)", (t) => {
  // 백엔드 브랜치가 아직 합쳐지지 않았으면 원본이 이 저장소에 없다. 그때는
  // ★조용히 통과시키지 않고 건너뛴 것으로 표시한다 — 죽은 초록이 가장 나쁘다.
  const candidates = [
    join(process.cwd(), "..", "v3", "functions", "src", "teamAudit.ts"),
    join(process.cwd(), "v3", "functions", "src", "teamAudit.ts"),
  ];
  const found = candidates.find((c) => existsSync(c));
  if (!found) {
    t.skip("v3/functions/src/teamAudit.ts 없음 — 백엔드 브랜치 병합 후 활성화");
    return;
  }
  const src = readFileSync(found, "utf8");
  // ★마커를 `indexOf` 로 맨 처음 찾으면 주석 속 언급(예: teamAudit.ts:22 의
  //   "`PROJECT_EVENT_TOOLS` 에 없는 툴은...")에 먼저 걸린다 — 진짜 선언보다
  //   앞에 있으면 그 자리에서 시작해 버린다. `export const <marker>` 선언에
  //   앵커해야 한다.
  // ★종결자를 문자열 `];` 로 찾으면 `new Set([...])` 는 `]);` 로 닫히므로 그
  //   자리를 지나쳐 다음 `];` (예: 뒤따르는 타입 유니온)까지 쓸어담는다. 리터럴
  //   문자열 검색 대신 여는 대괄호부터 **괄호 깊이**를 세어 그 배열이 실제로
  //   끝나는 지점을 찾는다 — `[...]` 든 `new Set([...])` 든 상관없이 맞는다.
  const collect = (marker: string): string[] => {
    const decl = new RegExp(`\\bexport const ${marker}\\b`).exec(src);
    if (!decl) return [];
    const open = src.indexOf("[", decl.index);
    if (open < 0) return [];
    let depth = 0;
    let end = -1;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "[") depth++;
      else if (src[i] === "]") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    const body = src.slice(open, end < 0 ? undefined : end);
    return [...body.matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"/g)].map((m) => m[1]);
  };
  const upstream = new Set([
    ...collect("FORBIDDEN_RESPONSE_KEYS"),
    ...collect("PROJECT_EVENT_TOOLS"),
  ]);
  const missing = [...upstream].filter((w) => !SERVER_INVENTORY.includes(w));
  assert.deepEqual(
    missing,
    [],
    `사본에 없는 서버 이름: ${missing.join(", ")} — SERVER_INVENTORY 를 갱신해라`
  );
});

test("basis 값 라벨이 세 로케일 전부에 있다 (라벨 없는 숫자 금지)", () => {
  for (const [locale, block] of LOCALES) {
    const copy = buildTeamCopy(block);
    for (const value of ["account_ledger", "project_event_ledger"]) {
      assert.ok(
        (copy.basisValues[value] ?? "").trim() !== "",
        `${locale} 에 ${value} 라벨이 없다`
      );
      // ★원문을 그대로 쓰면 라벨이 아니라 식별자를 보여 주는 것이다.
      assert.notEqual(copy.basisValues[value], value);
    }
  }
});

test("'정체' 기준 문장이 두 벌 있다 — 숫자 있는 것과 없는 것", () => {
  // ★상한을 문구에 박으면 서버가 바꿀 때 세 로케일이 조용히 낡는다. 숫자는
  //   서버 `criteria` 에서 값으로 받고, 못 받으면 숫자 없는 문장으로 떨어진다.
  for (const [locale, block] of LOCALES) {
    const copy = buildTeamCopy(block);
    const plain = copy.reasons["note_stalled_threshold"];
    const withHours = copy.reasons["note_stalled_threshold_hours"];
    assert.ok(plain, `${locale} 숫자 없는 문장`);
    assert.ok(withHours, `${locale} 숫자 있는 문장`);
    assert.ok(withHours.includes("{hours}"), `${locale} 자리표시자`);
    // 숫자 없는 쪽에 상한이 박혀 있으면 안 된다 — 아라비아 숫자도 한글 수사도.
    assert.doesNotMatch(plain, /\d/, `${locale} 숫자`);
    if (locale === "ko") {
      assert.doesNotMatch(plain, /[한두세네다섯여섯일곱여덟아홉열]\s*시간/);
    }
  }
});

test("모르는 basis 값은 사전에 없어도 되고, 화면은 원문으로 떨어진다", () => {
  const copy = buildTeamCopy(ko.team);
  // 라벨이 사라지는 경로가 없어야 한다 — 없으면 호출부가 원문을 그린다.
  assert.equal(copy.basisValues["brand_new_basis"], undefined);
});

test("fill 은 없는 자리표시자를 그대로 남긴다 (undefined 를 그리지 않는다)", () => {
  assert.equal(fill("{a}/{b}", { a: 1 }), "1/{b}");
  assert.equal(fill("{minutes}분 전", { minutes: 7 }), "7분 전");
});
