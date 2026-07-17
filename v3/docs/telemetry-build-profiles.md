# 텔레메트리 빌드 프로파일 — ON/OFF 매트릭스

> **⚠️ 2026-07-17 업데이트 (프로덕션 ON 승인, 티켓 aIaYFswyCRNdHbxm9g8O)**
> 아래 문서는 **폐기된 모델**(기본 OFF + `VITE_FIRST_PARTY_TELEMETRY=1` 도그푸드 opt-in)을
> 설명한다. **PR#397** 이후 `firstPartyGate.ts` 는 **모든 빌드에서 default-ON** 이며
> `VITE_FIRST_PARTY_TELEMETRY` 플래그는 어떤 소스에서도 읽히지 않는 **no-op(폐기)** 다.
> CEO 승인(2026-07-17)으로 실사용자 프로덕션 텔레메트리를 켠다 — **비식별 1차 집계만**
> (익명 install id, PII scrub, 3rd-party 공유는 여전히 옵트인). 유일한 하드 OFF 는
> `VITE_DISABLE_TELEMETRY=1`, 사용자 옵트아웃은 런타임 `setTelemetryEnabled(false)`.
> 도그푸드 npm 스크립트/CI 스텝은 이제 일반 빌드와 동일하게 동작한다(레거시 잔존).

- **작성**: 2026-07-12, devops 에이전트 (티켓 A4y1TvJxzYBGN07KPidi)
- **배경**: [docs/telemetry-ingestion-investigation.md](../../docs/telemetry-ingestion-investigation.md)
- **한 줄**: first-party 텔레메트리(Firebase Functions → BigQuery: heartbeat/event/cost)는
  **기본 OFF**. `VITE_FIRST_PARTY_TELEMETRY=1` 을 **빌드시점**에 주입한 **내부/도그푸드
  빌드에서만** ON. 외부 배포(release)·베타 빌드는 미설정 → OFF → **PIPA 준수**.

---

## 왜 이 구조인가

PR #137(2026-06-17)이 PIPA(제15조: 침묵은 동의가 아니다) 대응으로 first-party 분석
송신을 기본 OFF 로 전환했다. 그런데 이를 다시 켜는 **빌드 플래그·동의 UI 가 어디에도
없어서** 모든 실빌드가 100% OFF 가 됐고, 도그푸드 플릿에 적용된 6/22 23:54 KST 부터
BigQuery 적재가 완전 정지했다(약 3주 데이터 공백).

이 변경은 **게이트 로직(`firstPartyGate.ts`)·기본 OFF 를 손대지 않고**, 내부/도그푸드
빌드 프로파일에만 빌드시점 플래그를 주입해 관측을 복구한다. 외부 배포 경로는 그대로
OFF 유지.

## 단일 진실원

`src/lib/telemetry/firstPartyGate.ts`:

```ts
export function firstPartyTelemetryDefaultEnabled(): boolean {
  const env = import.meta.env;
  if (env?.VITE_DISABLE_TELEMETRY === "1") return false; // 하드 kill-switch (최우선)
  return env?.VITE_FIRST_PARTY_TELEMETRY === "1"; // 기본 OFF, 이 플래그로만 ON
}
```

Vite 는 `VITE_` 프리픽스 env(=`.env` 파일 + 프로세스 env)를 빌드시점에 `import.meta.env`
로 **정적 인라인**한다. 즉 빌드할 때 이 플래그가 켜져 있었는지가 산출물에 박제된다.
런타임 재구성 불가 → 외부 빌드에 우발적으로 켜질 위험이 원천 차단된다.

## ON/OFF 매트릭스

| 빌드 경로         | 명령 / 트리거                                                             | `VITE_FIRST_PARTY_TELEMETRY` | 게이트  | 대상              |
| ----------------- | ------------------------------------------------------------------------- | ---------------------------- | ------- | ----------------- |
| 로컬 기본         | `npm run build:mac` / `build:win` / `build:linux`                         | 미설정                       | **OFF** | 기본(외부와 동일) |
| **로컬 도그푸드** | `npm run build:mac:dogfood` (win/linux 동형)                              | `=1`                         | **ON**  | 내부 플릿         |
| CI — PR           | `pull_request`                                                            | 미설정                       | **OFF** | 검증 아티팩트     |
| CI — main push    | `push` (main)                                                             | 미설정                       | **OFF** | 아티팩트          |
| **CI — 도그푸드** | `workflow_dispatch`, 입력 `dogfood=true`                                  | `=1`                         | **ON**  | 내부 아티팩트     |
| **CI — 릴리스**   | 태그 `v*` push → `release` job → melocream/marblo-releases (auto-updater) | 미설정                       | **OFF** | **외부/베타**     |
| kill-switch       | 위 어느 경로든 `VITE_DISABLE_TELEMETRY=1` 동반                            | (무시)                       | **OFF** | 강제 차단         |

### 핵심 안전장치 — 외부 배포는 절대 ON 될 수 없다

외부 사용자에게 도달하는 유일한 경로는 **태그(`refs/tags/v*`) 빌드 → `release` job →
`melocream/marblo-releases` 발행 → electron-updater** 다. CI 의 플래그 주입 스텝은
**삼중 가드**로 이 경로를 원천 배제한다:

1. `workflow_dispatch` 이벤트에서만 (push/PR/tag 아님),
2. 명시적 `dogfood == 'true'` 입력이 있을 때만,
3. 태그 ref 가 **아닐** 때만 (`!startsWith(github.ref, 'refs/tags/')`).

로컬도 마찬가지로 **별도 `:dogfood` 스크립트를 명시 실행**해야만 켜진다. 기본
`build:mac` 등은 플래그를 주지 않는다.

## 로컬 도그푸드 빌드 방법

```bash
cd v3
npm run build:mac:dogfood      # mac (도그푸드 플릿 기본)
# npm run build:win:dogfood    # win  (mac/linux 셸에서 실행)
# npm run build:linux:dogfood  # linux
```

> `:dogfood` 스크립트는 `VITE_FIRST_PARTY_TELEMETRY=1 npm run build:<plat>` 형태의
> POSIX 셸 인라인 env 다. mac/linux 에서 동작한다(도그푸드 플릿=mac). Windows
> 로컬에서 직접 켜려면 `set VITE_FIRST_PARTY_TELEMETRY=1` 후 `npm run build:win`
> 또는 `cross-env` 를 사용한다.

## 검증

- **정적**: `grep -rn "VITE_FIRST_PARTY_TELEMETRY" v3/.env.example v3/package.json .github/workflows/build.yml`
  → 플래그가 도그푸드 스크립트/도그푸드 CI 스텝/문서에만 존재, 기본 빌드·릴리스 경로엔 없음.
- **유닛**: `npm test -- telemetry-local-only` — 게이트 OFF 시 callable 0회, 플래그/옵트인 시 발사(게이트 실동작 증명). 이 변경으로 무변경(그대로 green).
- **런타임(승인 후)**: 도그푸드 빌드 실행 → `logHeartbeat` 호출 재개 + BQ `marblo_telemetry.agent_heartbeats` 신규 row 확인.
- **회귀 방지**: 기본 `npm run build:mac`(플래그 미주입) 산출물은 OFF 유지 — 외부 배포 무영향.

## 하지 않은 것 (범위 밖)

- BQ 삭제/재적재·Functions 재배포 — **불필요·금지**. 함수는 이미 정상 배포 상태이고
  문제는 클라이언트 플래그뿐이다.
- 게이트 로직·기본 OFF 변경 — 손대지 않음(빌드시점 플래그 주입만).
- 런타임 동의 UI(dev8, Option B) — 외부 사용자 정식 옵트인 경로는 별도 티켓.
