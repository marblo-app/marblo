# 벤더 키 존재 판정 — 왜 값은 안 주고 3상태만 주는가

**티켓** `DmfFZdKpNig5AiZ7Bp3p` · **작성** 2026-09-05 · **선행 사고** `pW7c7b0p2FdAmhaLj1Xq`(Upstage Solar 라이브 검증, 전날 오진)

---

## 0. 한 줄 결론

> **"없다"와 "못 읽는다"를 구분 못 해서 오진이 났다.** 8/21부터 등록돼 있던 UPSTAGE/DEEPSEEK/MINIMAX
> 세 키가, 순수 node 로 뜬 백엔드 에이전트 셸에서는 존재 자체를 확인할 방법이 없어 "없음"으로 보고됐다.
> 고친 것은 **판정 경로 하나**다 — 값은 여전히 그 셸로 가지 않는다.

---

## 1. 사고 재구성 (코드로 반증)

`vendor-secrets.ts`(`readDecrypted`)는 이렇게 짜여 있었다(지금도 값 조회 경로는 그대로다):

```ts
function readDecrypted(): Record<string, string> {
  const el = loadElectron();
  if (!el || !el.appReady) return {}; // ← 여기서 파일을 아예 열어보지 않는다
  ...
}
```

`getVendorSecret`/`vendorEnvReadiness`는 전부 이 함수를 거친다. Electron이 없는 프로세스(백엔드
에이전트가 뜨는 MCP 서버는 순수 node다)에서는 **파일이 있든 없든** 항상 빈 맵이 돌아온다. 그 결과
"키 없음"과 "판정 불가"가 코드 레벨에서 이미 같은 값(`undefined`)으로 뭉개져 있었다.

재현(이 저장소, 값은 한 번도 출력하지 않음 — 이름과 ciphertext 길이만 확인):

```
$ node -e '... fs.readFileSync(~/.marblo/vendor-secrets.enc.json) ...'
keys present: [ 'DEEPSEEK_API_KEY', 'MINIMAX_API_KEY', 'UPSTAGE_API_KEY' ]
UPSTAGE_API_KEY ciphertext_len=68
```

**핵심 통찰**: 이 파일은 평범한 JSON이다. `fs.readFileSync`만으로 어느 프로세스에서든 열린다 — 안의
값이 base64 ciphertext라 못 읽을 뿐이다. 즉 **"이 키 이름이 등록됐는가"라는 존재 질문은 safeStorage
없이도 항상 답할 수 있다.** 못 답할 이유가 있던 건 값(복호화) 질문뿐이었는데, 코드가 두 질문을 분리하지
않아서 존재 질문까지 같이 막혀 있었다.

---

## 2. 왜 safeStorage 인가 — 코드가 이미 답을 갖고 있다

`vendor-secrets.ts` 머리말(수정 전부터 있던 주석, 이번에 새로 쓴 게 아니다)이 명시적으로 못박는
보안 불변식 두 개:

1. **평문 미저장** — 암호화가 안 되면 쓰지 않고 throw한다(`mutateStore`). "느슨하게 파일에 평문으로
   떨어지느니 저장을 거부한다"는 판단.
2. **평문 미유출** — "이 모듈에서 평문을 돌려주는 함수는 `getVendorSecret` 하나뿐이고, 그 호출자는
   스폰 env를 조립하는 `resolveVendorEnvProfile` 뿐이다."

(2)가 이 티켓의 세 갈래 중 **갈래 1("에이전트에 키를 직접 준다")을 사실상 기각하는 근거**다 —
이건 "OS 키체인을 쓰자"는 구현 선택이 아니라 "평문이 main(Electron) 프로세스 경계를 절대 넘지
않는다"는 **설계 의도**다. 백엔드 에이전트 셸(PTY로 사람이 들여다볼 수 있고, 크래시 리포트가 로그를
자동수집하는 프로세스)에 실제 키 값을 env로 주입하면 이 불변식을 정면으로 깬다.

---

## 3. 세 갈래 판단

| 갈래                           | 판단                 | 근거                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. 에이전트가 키를 받는다**  | 기각                 | §2의 불변식(2)를 정면으로 깬다. `getMCPServerEnv`(agent-config.ts)의 MCP env allowlist는 지금 `PATH`/`MARBLO_*`/`VITE_FIREBASE_*`/`FIREBASE_*`만 통과시킨다 — 벤더 키를 여기 추가하는 건 이 티켓이 하지 않는다.                                                                                                                                                                                                                                                                          |
| **2. 앱이 대신 호출한다**      | 이미 구현됨(다른 축) | "임의 벤더 HTTP 호출을 에이전트 대신 앱이 중계"하는 범용 프록시는 없다. 하지만 **실제로 필요한 것**(Solar Pro 4/DeepSeek 라이브 A/B)은 "codex/gpt 워커를 그 벤더 모델로 스폰"이고, 그 경로는 이미 `bridge-server.ts`(Electron main, safeStorage 보유) 안에서 `vendorEnvReadiness` 게이트 + `codex-vendor-provider.ts`가 스폰 시점에 안전하게 처리한다. 값은 스폰되는 codex 프로세스의 env로만 가고, 그 프로세스를 명령하는 백엔드 에이전트 자신의 셸에는 안 간다. 새로 만들 배선이 없다. |
| **3. 존재함/없음/못읽음 구분** | **구현**             | 가장 싸고 가장 확실하다(요구사항 자체가 "이것만으로도 오늘 오진은 안 났다"). 파일 존재 판정에 Electron이 필요 없다는 게 §1의 통찰 — 구현 비용이 낮다.                                                                                                                                                                                                                                                                                                                                    |

**결론: 3번을 구현했고, 1·2번은 새 코드가 필요 없다는 것까지 확인했다** — 2번은 "필요한 형태로는
이미 있다"는 것이 이번 조사의 발견이지 이번에 만든 것이 아니다.

---

## 4. 구현 — 값은 어디로도 안 간다

- `vendor-secrets.ts`: `vendorSecretPresence(envKey)` / `vendorSecretPresenceReport(envKeys?)`.
  반환 타입이 `"present" | "absent" | "unreadable"` 리터럴 유니온이다 — 타입 레벨에서 값을 담을
  수 없다. `process.env` 우선순위, allowlist, "파일에 키는 있지만 이 프로세스가 못 연다"의 세 갈래를
  기존 `readStoreFile()`(순수 `fs`, Electron 불필요)과 `loadElectron()`(있으면 실제 복호화 시도,
  실패해도 원인 문자열이 아니라 `"unreadable"` 상수만 반환)만으로 구성했다. 기존 `getVendorSecret`/
  `vendorSecretStatus`의 동작·시그니처는 손대지 않았다(그 함수들이 답하는 "쓸 수 있는 값을 다오"라는
  질문은 여전히 유효하고, 여전히 값을 안전하게 안 새게 유지한다).
- `bridge-server.ts`: `GET /vendor-secret-presence` — 기존 `/model-guidance`와 같은 패턴(정적
  지식을 main 프로세스에서 MCP로 값 없이 전달). 이 라우트도 기존 bearer 토큰 게이트
  (`isAuthorized`)를 그대로 통과해야 한다 — 새 인증 예외를 만들지 않았다.
- `mcp-server/tools.ts`: `vendor_secret_status` MCP 툴. `userFacing: false`(감사 로그에도 값이
  안 남는다). 브리지 호출이 실패해도 **"없음"으로 위장하지 않는다** — 실패 사유를 그대로 텍스트로
  돌려주고, "이 실패 자체가 unreadable과 같은 뜻"이라고 명시한다(같은 오진을 다른 층에서 반복하지
  않기 위해).
- `tool-surface.ts`: `backend` 역할 화이트리스트에 `vendor_secret_status` 추가.

**흐름 끝까지**: 실제 시크릿 평문은 여전히 `getVendorSecret` → `resolveVendorEnvProfile`
경로로만, Electron main 프로세스 안에서, 벤더로 스폰되는 codex/claude 자식 프로세스의 env로만
간다. 이번에 추가한 새 경로(브리지 라우트 → MCP 툴)는 리터럴 3값 중 하나만 나른다 — PTY 버퍼에
찍혀도, 크래시 리포트에 스냅샷돼도 새어나갈 값 자체가 없다.

---

## 5. 알려진 별건 갭과의 겹침 확인

`v3/functions/src/redact.ts`(버그리포트 `recentLogs`/`agentSnapshot` best-effort redaction)의
`api[_-]?key` 정규식은 `\b`(단어 경계) 앞에 걸려 있다. `UPSTAGE_API_KEY`처럼 `_API_KEY`가 다른
식별자에 **붙어** 있으면(예: 로그에 `UPSTAGE_API_KEY=sk-...` 형태로 찍히는 경우) `_`와 `A`가 둘 다
단어 문자라 경계가 성립하지 않아 **매칭되지 않는다** — 즉 이 벤더 키 이름들은 그 redaction의
사각지대와 겹친다.

**이 티켓 범위에서 조치하지 않는다** — 별건으로 이미 추적 중인 갭이고, 이번 변경이 그 갭을 새로
만들지도, 악화시키지도 않는다(§4에서 값 자체가 새 경로를 타지 않으므로). 다만 확인해 달라는 요청이라
여기 명시한다: **`redact.ts`의 `api[_-]?key` 패턴 앞에 `\b` 대신 `(?:^|[^A-Za-z0-9_])`류 경계를
쓰는 보강이 필요하다** — 이건 이 티켓이 아니라 그 별건 티켓의 몫이다.

---

## 6. 뮤테이션 확인

`vendorSecretPresence`의 `unreadable` 분기를 `absent`로 collapse(1줄 변경) 후
`tests/unit/vendor-secret-presence.test.ts` 재실행 → **7건 중 2건 실제로 빨개짐**
(`"파일엔 키가 등록돼 있지만 ... unreadable"`, `"vendorSecretPresenceReport"`). 원복 후 7건 전부
통과 확인. 판정 로직이 테스트로 실제로 고정돼 있다는 증거다.

---

## 7. 완료 기준 대조

- [x] 존재함/없음/못읽음 구분 — 테스트로 고정(§6)
- [x] 세 갈래 중 고른 것(3)과 근거, 안 고른 것(1 기각/2 이미 있음)의 근거 — §3
- [x] 키가 어디까지 흐르는지 보안 판단 — §4, 별건 갭 겹침 — §5
- [x] 뮤테이션 확인(숫자로) — §6
- [x] 키 원문 미노출 — 값은 코드 어디에도 출력·로그·테스트 픽스처에 없다(가짜 ciphertext만 사용)
- [x] `npm run typecheck` 통과, 관련 테스트 통과(신규 7 + 기존 vendor-secret-store 16 +
      vendor-secret-injection 12 + worker-tool-surface 19 = 54건, 전체 유닛 스위트 566파일/9265건)
- [x] 기존 저장소 불변 — 8/21 등록된 세 키는 이번 변경으로 어떤 파일 쓰기도 겪지 않았다(읽기 전용
      함수만 추가, `setVendorSecret`/`mutateStore` 미변경)
