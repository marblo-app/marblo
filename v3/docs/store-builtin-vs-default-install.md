# 빌트인 vs official 기본설치 — 스토어에 무엇이 뜨고 무엇이 이미 깔려 있나

앱을 처음 열었을 때 사용자가 갖고 있는 자산은 두 갈래로 들어온다. 이름이
비슷해서 계속 섞이는데, **사용자에게는 정반대의 물건이다.** 이 문서는 그 둘의
경계를 적는다.

|             | 빌트인                                          | official 기본설치                          |
| ----------- | ----------------------------------------------- | ------------------------------------------ |
| 설치 개념   | **없다** — 앱/CLI 안에 들어 있다                | **있다** — 레지스트리에서 받아 홈에 쓴다   |
| 스토어 목록 | **숨긴다**                                      | **보인다**                                 |
| 제거        | 불가(앱의 일부)                                 | 가능(스토어 제거 버튼)                     |
| 원장 기록   | 없음                                            | 있음(`registry-installs.json`)             |
| 예          | tf-\* 워크플로, `marblo-control`, `code-review` | QA Engineer, Reviewer 등 official 에이전트 |

---

## 1. 빌트인 — 스토어에서 숨긴다

사용자가 **이미 갖고 있는** 것들이다. 설치 버튼을 눌러야 생기는 물건이 아니라
앱(또는 하네스 CLI)이 심어 놓고 시작하는 물건이라, 스토어에 뜨면 "안 깔려
있나?" 라는 없는 질문을 만든다.

정의: `v3/electron/registry-installer.ts` 의 `BUILTIN_REGISTRY_ITEM_IDS`.

출처가 **세 갈래**라 단일 파생 규칙으로 덮이지 않는다. 그래서 명시 집합이다:

1. **앱 번들 tf-\*** — `bundle-installer` 가 매 기동 `~/.claude/{commands,skills}`
   에 심는다. 레지스트리에는 이 중 일부만 워크플로로 게시돼 있지만 집합은 번들
   전체(18종)를 담는다. 번들이 늘었는데 집합을 안 고치면
   `registry-builtin-and-default-install.test.ts` 가 `.claude/commands` 와
   대조해서 깨진다.
2. **`marblo-control`** — 오케스트레이터가 보드를 굴리는 MCP. 매니페스트 본문이
   "Ships with the Marblo app" 이다. 앱 프로세스가 곧 이 서버라 설치할 대상이
   없다.
3. **`code-review`** — 하네스 CLI(Claude Code)에 같은 이름의 네이티브 스킬이
   이미 있다. ★이것만 성격이 다르다: files 설치 계약이 **있는** 항목이라 누르면
   실제로 `~/.claude/skills/code-review` 가 생기고, 그 순간 CLI 내장
   `/code-review` 와 이름이 겹친다. 그래서 숨기는 쪽이 안전하다.

강제 지점은 둘이다 — 표시(`overlayInstallState`)와 설치
(`assertInstallableItem`). **표시 정책이 방어선이면 안 되기 때문에** 둘을
분리했다: 목록을 여는 변경이 조용히 설치까지 열지 못한다.

### 숨김이 잠금이 되면 안 된다

빌트인이라도 **원장에 있으면 목록에 그대로 남는다**. 빌트인으로 지정되기 전
버전에서 이미 설치한 사용자가 있을 수 있고, 그 항목을 목록에서 지워 버리면
제거 버튼까지 같이 사라져 자기 홈에 남은 파일을 UI 로 되돌릴 방법이 없어진다.

---

## 2. official 기본설치 — 설치형인데 첫 실행에 우리가 눌러 준다

빈 에이전트 목록으로 시작하는 앱은 "무엇을 스폰하라는 건지"에 답하지 않는다.
그래서 우리가 만든 official 티어 에이전트는 첫 실행에 우리가 대신 깐다.

대상 판정은 하드코딩 id 목록이 아니라 **데이터 기반 규칙**이다
(`isDefaultInstallCandidate`): `tier=official` ∧ `type=agent` ∧ `status=active`
∧ `install.kind=files` ∧ 빌트인 아님. 현재 레지스트리 기준 13개(QA Engineer·
Reviewer Agent 포함).

이 항목들은 **설치형 그대로다.** 스토어에 보이고, 원장에 남고, 제거할 수 있다.
우리가 한 일은 첫 설치 버튼을 대신 눌러 준 것뿐이다.

### 강제가 아니라는 것의 실질적 의미

"지운 것이 되살아나지 않는다" 이다. 그 보장을 마커 하나
(`ledger.defaultInstallAt`)로 만든다 — 패스는 앱 수명에서 딱 한 번 완주하고,
그 뒤에는 레지스트리에 official 에이전트가 몇 개 추가되든 다시 돌지 않는다.
그때부터는 사용자가 스토어에서 직접 고르는 영역이다.

마커를 원장에 두는 이유: 마커의 유일한 목적이 "지운 것을 다시 안 깔기"인데 그
판단의 근거(무엇이 깔렸는가)가 같은 파일에 있다. 별도 파일로 빼면 원장만 손상
격리되고 마커는 남아 — 아무것도 안 깔린 채 "이미 돌았음"이 되는 상태가 생긴다.

### 언제 도는가

기동 시 1회, **await 하지 않고** 백그라운드로(네트워크가 낀 일이 창 생성을
늦추면 안 된다). 그리고 **인덱스가 신선할 때만** 돈다:

- 인덱스 `stale`/`unavailable` → 아무 일도 안 하고 다음 기동에 재시도.
  "물어보지도 못한" 실행이 완주 마커를 찍으면 그 사용자는 기본 에이전트를 영영
  못 받는다.
- 후보 0개 → 마커 안 찍음(빈 인덱스로 완주 처리 방지).
- 일부 항목 실패 → **마커를 찍고 끝낸다.** 부분 실패로 무한 재시도하면 매 기동
  네트워크를 두드리게 된다. 실패는 로그에 남고, 사용자는 스토어에서 직접 깔 수
  있다.

---

## 3. 관련 코드

| 무엇               | 어디                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| 빌트인 집합·판정   | `v3/electron/registry-installer.ts` — `BUILTIN_REGISTRY_ITEM_IDS`, `isBuiltinRegistryItem`       |
| 목록에서 숨김      | `v3/electron/registry-installer.ts` — `overlayInstallState`                                      |
| 설치 거부          | `v3/electron/registry-installer.ts` — `assertInstallableItem`                                    |
| 기본설치 대상·패스 | `v3/electron/registry-installer.ts` — `isDefaultInstallCandidate`, `installDefaultRegistryItems` |
| 멱등 마커          | `v3/electron/registry-ledger.ts` — `RegistryLedger.defaultInstallAt`                             |
| 기동 배선          | `v3/electron/main.ts` — `installBundledHarness()` 직후                                           |
| 테스트             | `v3/tests/unit/registry-builtin-and-default-install.test.ts`                                     |
