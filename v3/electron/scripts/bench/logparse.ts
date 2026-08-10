/**
 * 테스트 러너 로그 → 테스트 id별 상태.
 *
 * ★여기가 채점의 급소다. 데이터셋의 F2P/P2P id 는 "우리가 정한 이름"이 아니라
 * **러너가 로그에 찍는 문자열 그대로**다. 그래서 파서는 예쁜 id 를 만들려 하면
 * 안 되고, 로그 줄을 있는 그대로 떠와야 한다.
 *
 * django 실측(2026-08-10, django 5.0.dev / runtests.py --verbosity 2):
 *
 *   docstring 없는 테스트 —
 *     `test_content_type_file (responses.test_fileresponse.FileResponseTests.test_content_type_file) ... ok`
 *
 *   ★docstring 있는 테스트 — id 가 **메서드명이 아니라 docstring 첫 줄**이 된다:
 *     `test_compressed_response (responses...FileResponseTests.test_compressed_response)`
 *     `If compressed responses are served with the uncompressed Content-Type ... ok`
 *                                                                            ^^^^^^^^
 *   그리고 데이터셋의 F2P 값이 실제로
 *     "If compressed responses are served with the uncompressed Content-Type"
 *   이다. 즉 "` ... ok` 앞부분을 그대로 뜬다"가 정답이고, 메서드명을 조립하려는
 *   구현은 이 부류 인스턴스에서 전부 오채점된다.
 */
import type { LogParserKind, TestStatusMap } from "./types";

/**
 * ★파이썬 버전에 따라 django 가 찍는 테스트 id 형식이 **두 가지**다.
 *
 *   Python ≤3.10 : `test_basic (dbshell.test_postgresql.PostgreSqlDbshellCommandTestCase)`
 *   Python ≥3.11 : `test_basic (dbshell.test_postgresql.PostgreSqlDbshellCommandTestCase.test_basic)`
 *                                                                                      ^^^^^^^^^^^ 메서드명이 붙는다
 *
 * 그리고 데이터셋의 F2P/P2P id 는 **그 인스턴스의 공식 Docker 이미지가 쓰던
 * 파이썬 버전**의 형식으로 굳어 있다 — 실측(2026-08-10): django 4.2 인스턴스는
 * 구형식, 5.0 인스턴스는 신형식.
 *
 * 우리는 전 인스턴스를 python3.11 로 돌리므로 신형식만 나온다. 그래서 4.2
 * 인스턴스는 **테스트가 전부 통과했는데도 id 가 하나도 안 맞아 resolved=false**
 * 가 나왔다(gold 자체검증이 이걸 잡았다 — 그 목적으로 만든 모드다).
 *
 * 처분: 신형식 이름을 구형식으로도 **함께 등록**한다. 같은 테스트를 가리키는
 * 두 표기이므로 별칭이지 관대한 채점이 아니다. 반대 방향(구→신)은 만들지 않는다
 * — 메서드명을 지어내야 하기 때문이다.
 */
function aliasesFor(name: string): string[] {
  const m = /^(\w+) \((.+)\.\1\)$/.exec(name);
  return m ? [`${m[1]} (${m[2]})`] : [];
}

/** `<name> ... <status>` 꼬리를 상태로 해석한다. */
const DJANGO_SUFFIXES: Array<[string, TestStatusMap[string]]> = [
  [" ... ok", "PASSED"],
  [" ... FAIL", "FAILED"],
  [" ... ERROR", "ERROR"],
];

function parseDjango(log: string): TestStatusMap {
  const map: TestStatusMap = {};
  for (const raw of log.split("\n")) {
    const line = raw.trim();

    let matched = false;
    for (const [suffix, status] of DJANGO_SUFFIXES) {
      if (line.endsWith(suffix)) {
        const name = line.slice(0, -suffix.length).trim();
        if (name) {
          map[name] = status;
          for (const alias of aliasesFor(name)) map[alias] = status;
        }
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // `... skipped 'reason'` 은 꼬리가 가변이라 별도 처리.
    const skipped = / \.\.\. skipped /.exec(line);
    if (skipped) {
      const name = line.slice(0, skipped.index).trim();
      if (name) {
        map[name] = "SKIPPED";
        for (const alias of aliasesFor(name)) map[alias] = "SKIPPED";
      }
      continue;
    }

    // 요약 블록의 `FAIL: <test>` / `ERROR: <test>` 헤더. 위의 `... ok` 로 이미
    // PASSED 가 찍힌 이름을 여기서 덮어쓰지 않는다 — 파라미터화 서브테스트는
    // 헤더 이름과 통과 줄의 이름이 서로 다른 문자열이라 덮어쓰면 오채점된다.
    const header = /^(FAIL|ERROR): (.+)$/.exec(line);
    if (header) {
      const name = header[2].trim();
      const status = header[1] === "FAIL" ? "FAILED" : "ERROR";
      for (const n of [name, ...aliasesFor(name)]) {
        if (n && !(n in map)) map[n] = status;
      }
    }
  }
  return map;
}

/**
 * pytest `-rA` 짧은 요약 파서. 지금 고정한 인스턴스는 전부 django 라
 * 실사용 경로가 아니지만, 레포를 늘릴 때 첫 후보가 pytest 계열이라 미리 둔다.
 * ★미검증 코드임을 명시한다 — 실제로 쓰기 전에 gold 자체검증을 먼저 통과시킬 것.
 */
function parsePytest(log: string): TestStatusMap {
  const map: TestStatusMap = {};
  const re = /^(PASSED|FAILED|ERROR|SKIPPED|XFAIL|XPASS)\s+(\S+)/;
  for (const raw of log.split("\n")) {
    const m = re.exec(raw.trim());
    if (!m) continue;
    const status = m[1];
    map[m[2]] =
      status === "PASSED" || status === "XFAIL"
        ? "PASSED"
        : status === "SKIPPED"
        ? "SKIPPED"
        : status === "XPASS"
        ? "PASSED"
        : status === "ERROR"
        ? "ERROR"
        : "FAILED";
  }
  return map;
}

export function parseTestLog(kind: LogParserKind, log: string): TestStatusMap {
  return kind === "django" ? parseDjango(log) : parsePytest(log);
}
