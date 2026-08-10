// SWE-bench 자체 하네스의 **채점 급소**를 못박는다.
//
// 배경: 이 파서의 첫 버전은 django 인스턴스 3개 중 2개에서 "테스트는 전부 통과
// 했는데 resolved=false" 를 냈다. 원인은 모델도 환경도 아니고, django 가 찍는
// 테스트 id 형식이 **파이썬 버전마다 다르다**는 것이었다:
//
//   Python ≤3.10 : `test_basic (module.Class)`
//   Python ≥3.11 : `test_basic (module.Class.test_basic)`
//
// 그리고 데이터셋의 F2P/P2P id 는 그 인스턴스의 공식 이미지가 쓰던 파이썬
// 버전의 형식으로 굳어 있다. 이 테스트는 그 회귀를 막는다 — 채점기가 조용히
// 0점을 주는 실패모드는 벤치 전체를 무가치하게 만들기 때문이다.
import { describe, it, expect } from "vitest";
import { parseTestLog } from "../../electron/scripts/bench/logparse";

describe("django 테스트 로그 파서", () => {
  it("일반 테스트의 `... ok` 를 PASSED 로 읽는다", () => {
    const log =
      "test_content_type_file (responses.test_fileresponse.FileResponseTests.test_content_type_file) ... ok";
    const s = parseTestLog("django", log);
    expect(
      s[
        "test_content_type_file (responses.test_fileresponse.FileResponseTests.test_content_type_file)"
      ],
    ).toBe("PASSED");
  });

  it("★신형식(py≥3.11) 이름을 구형식(py≤3.10)으로도 함께 등록한다", () => {
    // 우리는 python3.11 로 돌아 신형식만 찍히는데, django 4.2 인스턴스의
    // 데이터셋 id 는 구형식이다. 별칭이 없으면 교집합이 0이 되어 전부 오답 처리된다.
    const log =
      "test_basic (dbshell.test_postgresql.PostgreSqlDbshellCommandTestCase.test_basic) ... ok";
    const s = parseTestLog("django", log);
    expect(
      s[
        "test_basic (dbshell.test_postgresql.PostgreSqlDbshellCommandTestCase)"
      ],
    ).toBe("PASSED");
  });

  it("구형식 id 로부터 신형식을 지어내지 않는다", () => {
    // 반대 방향 별칭은 메서드명을 추측해야 하므로 만들지 않는다.
    const log =
      "test_basic (dbshell.test_postgresql.PostgreSqlDbshellCommandTestCase) ... ok";
    const s = parseTestLog("django", log);
    expect(
      s[
        "test_basic (dbshell.test_postgresql.PostgreSqlDbshellCommandTestCase)"
      ],
    ).toBe("PASSED");
    expect(
      s[
        "test_basic (dbshell.test_postgresql.PostgreSqlDbshellCommandTestCase.test_basic)"
      ],
    ).toBeUndefined();
  });

  it("★docstring 이 있는 테스트는 docstring 줄이 id 다", () => {
    // 데이터셋의 F2P 가 실제로 이 문자열이다(django__django-16642).
    const log = [
      "test_compressed_response (responses.test_fileresponse.FileResponseTests.test_compressed_response)",
      "If compressed responses are served with the uncompressed Content-Type ... ok",
    ].join("\n");
    const s = parseTestLog("django", log);
    expect(
      s[
        "If compressed responses are served with the uncompressed Content-Type"
      ],
    ).toBe("PASSED");
  });

  it("FAIL/ERROR 요약 헤더가 이미 통과한 이름을 덮어쓰지 않는다", () => {
    // 파라미터화 서브테스트는 헤더 이름과 통과 줄 이름이 다른 문자열이라,
    // 덮어쓰면 통과한 테스트가 실패로 뒤집힌다.
    const log = [
      "Some docstring line ... ok",
      "======================================================================",
      "FAIL: Some docstring line",
    ].join("\n");
    const s = parseTestLog("django", log);
    expect(s["Some docstring line"]).toBe("PASSED");
  });

  it("skipped 를 PASSED 로 세지 않는다", () => {
    const log =
      "test_sigint_handler (dbshell.test_postgresql.T.test_sigint_handler) ... skipped 'Requires a PostgreSQL connection'";
    const s = parseTestLog("django", log);
    expect(
      s["test_sigint_handler (dbshell.test_postgresql.T.test_sigint_handler)"],
    ).toBe("SKIPPED");
    // 별칭도 SKIPPED 로 남아야 한다 — PASSED 로 새면 채점이 관대해진다.
    expect(s["test_sigint_handler (dbshell.test_postgresql.T)"]).toBe(
      "SKIPPED",
    );
  });

  it("FAIL 은 FAILED 로 읽는다", () => {
    const log = "test_x (mod.C.test_x) ... FAIL";
    const s = parseTestLog("django", log);
    expect(s["test_x (mod.C.test_x)"]).toBe("FAILED");
    expect(s["test_x (mod.C)"]).toBe("FAILED");
  });
});

describe("pytest 파서", () => {
  it("`-rA` 요약 줄을 읽는다", () => {
    const log = [
      "PASSED testing/test_a.py::test_one",
      "FAILED testing/test_a.py::test_two",
    ].join("\n");
    const s = parseTestLog("pytest", log);
    expect(s["testing/test_a.py::test_one"]).toBe("PASSED");
    expect(s["testing/test_a.py::test_two"]).toBe("FAILED");
  });
});
