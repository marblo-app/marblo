# CI verify 테스트 결정성 기록

## 배경

2026-09-03 PR #1384의 verify run `33708302470`에서 `continue-on-error`를
제거하자 11개 파일, 26개 테스트가 실패했다. 개발 Mac에서는 같은 시점에
8768/8769가 통과했으므로, 로컬의 초록 결과만으로 회귀 여부를 판단하면 안 된다.

이 문서는 해당 실패를 분류하고, 테스트가 어떤 외부 상태를 명시적으로 고정해야
하는지 기록한다. 실제 앱 창이나 브라우저는 검증에 사용하지 않는다.

## 분류표

| 분류 | CI 실패 | 근거 | 조치 |
| --- | ---: | --- | --- |
| 실제 제품 회귀 | 0 | 실패 출력이 모두 외부 입력 또는 테스트 timing으로 설명되고, 정책/argv를 같은 고정 입력으로 다시 실행한 focused suite 254건이 통과했다. | 별도 제품 수정 티켓 없음 |
| CI 환경 결합: Claude CLI | 19 | runner에는 managed Claude 후보가 없어 `realpath_failed`(`/home/runner/.local`, `/opt/homebrew`, `/usr/local/bin/claude`, `.npm-global`)가 기록됐다. `min_cli_unverified` 정책이 안전 alias `opus`로 폴백해 구체 pin 기대와 달라졌다. | `setClaudeBinaryResolverForTesting` seam에 호환 버전 `2.1.220`을 주입한다. |
| CI 환경 결합: bridge token | 3 | GLM/Kimi/MiniMax 테스트가 MCP 배선을 검증하면서 ambient `MARBLO_BRIDGE_TOKEN` 존재를 기대했다. CI에는 앱 bridge가 없다. | 테스트가 자리표시자 token을 `vi.stubEnv`로 주입한다. |
| CI 환경 결합: Git identity | 1 | runner의 `git commit --allow-empty`가 committer name/email 없음으로 실패했다. | fixture commit에 author와 committer identity를 함께 전달한다. |
| CI 환경 결합: 시간대 | 1 | `2026-08-13T09:30:00+09:00`은 Korea에서는 09:30이나 UTC runner에서는 00:30이다. cron matcher는 process-local wall clock을 해석한다. | ISO offset instant 대신 local `Date(year, month, …)`를 만든다. |
| 동시실행/타이밍 flake: BeginnerTour | 1 | 고정 횟수의 rAF/timeout flush 뒤 첫 DOM assertion이 CI에서 먼저 실행됐다. | 화면이 나타날 때까지 `findByTestId`로 기다린다. |
| 동시실행/네트워크 flake: dev-server-origin | 1 | 빈 포트를 예약한 뒤 닫고 다시 bind하는 race와 `localhost`의 주소패밀리/DNS 순서 가정 때문에 `ECONNRESET`이 났다. 격리 재실행 6/6 통과 단서와 일치한다. | 서버가 OS-assigned port에서 직접 listen하도록 하고, readiness는 실제 bind host에, HTTP 응답은 literal loopback endpoint에 확인한다. negative test는 예약 불가 port 0을 쓴다. |

### 19건의 Claude CLI 결합 세부

- `bridge-dispatch-autoselect.test.ts`: 10
- `bridge-dispatch-model-pin.test.ts`: 4
- `model-selection.test.ts`: 1
- `provider-harness-axis.test.ts`: 1
- `vendor-glm-zai.test.ts`, `vendor-kimi-code.test.ts`, `vendor-minimax.test.ts`: 각 1

이는 이전 워크체인 `wc_8u9u9tdn7r`의 `model-autoselect.test.ts` 사전 실패
단서와 같은 뿌리다. 테스트가 "호환 Claude CLI에서 어떤 구체 모델 pin을
생성하는가"를 검증하면서 실제 runner의 CLI 탐색 결과까지 무의식적으로
검증하고 있었다.

## 로컬과 CI가 달랐던 이유

로컬 개발 환경은 실제 Claude 설치/버전, 실행 중인 bridge token, 전역 Git
identity, Asia/Seoul 시간대, 그리고 사용 가능한 loopback/DNS 순서를 갖는다.
GitHub Actions runner는 이들 중 일부 또는 전부가 없다. 특히 Claude resolver는
없는 후보를 `realpath_failed`로 보고한 뒤, 검증할 수 없는 신형 모델을 안전한
`opus` alias로 폴백하는 것이 제품의 정상 동작이다. 테스트가 그 환경 입력을
고정하지 않으면 로컬에서는 구체 id가, CI에서는 alias가 나와 서로 다른 결과가
된다.

따라서 다음 규칙을 지킨다.

1. 모델 정책/argv 테스트는 실제 CLI 탐색 대신 explicit resolver를 주입한다.
2. spawned-agent env를 단언하면 token 등 필요한 ambient 값도 fixture에 넣는다.
3. 로컬 시간 의미를 검증하면 offset instant가 아닌 local wall-clock Date를 쓴다.
4. 소켓 테스트는 release-then-bind를 피하고 DNS의 `localhost` 주소 선택을
   제품 origin의 증거로 사용하지 않는다.

## 검증 기준

수정 후에는 focused CI-실패 대상 11개 파일/254개 테스트가 모두 통과해야 한다.
완료 판단은 반드시 변경 PR의 실제 GitHub `verify` 체크 결과로 한다. 로컬
통과는 회귀 탐지 보조 근거일 뿐, CI gate 통과의 대체 근거가 아니다.
