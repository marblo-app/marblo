# PoC — 의도 스크립트 재생 (spike)

판정과 해석은 [`../web-task-recording-intent-replay-2026-08-28.md`](../web-task-recording-intent-replay-2026-08-28.md) 에 있다.
여기는 그 문서의 숫자를 만든 코드다. **제품 코드가 아니다** — `v3/src`, `package.json` 을 건드리지 않는다.

## 무엇을 증명하려고 만들었나

녹화한 웹 작업을 **사이트가 바뀐 뒤에도** 재생할 수 있는가. 셀렉터 재생과
의도 스크립트를 같은 녹화본으로 나란히 돌려서 비교한다.

## 돌리는 법

```bash
export PATH="$HOME/.nvm/versions/node/v22.13.0/bin:$PATH"
node record.mjs                        # V0 에서 녹화
node run-poc.mjs                       # 6 변종 × 3 전략
node run-poc.mjs --arms selector-only  # 모델 호출 없이
SPIKE_MODEL=sonnet node run-poc.mjs    # 폴백 모델 교체
```

브라우저는 `channel: "chrome"` 으로 사용자의 Chrome 을 쓴다(다운로드 0).
모델 폴백은 로컬 `claude -p` CLI 를 쓴다 — 새 의존성 없음, 외부 사이트 접속 없음.

## 구성

```
fixtures/           로컬 정적 HTML. v0 원본 + v1~v5 파괴 변종. 서버는 127.0.0.1 임시 포트
record.mjs          V0 에서 사람 세션을 녹화 → recorded/*.intent.json
run-poc.mjs         매트릭스 실행. 결과 → out/
lib/recorder-hook.mjs  페이지에 주입되는 녹화기(진짜 DOM 이벤트를 듣는다)
lib/snapshot.mjs    폴백이 보는 화면 스냅샷. id/class 를 넣지 않는다
lib/resolve.mjs     해석 사다리(css → xpath → role → attrs → 모델) + 정합성 검사
lib/resolver-llm.mjs 모델 폴백. 프롬프트 생성 + 1회 재시도
lib/replay.mjs      실행 + ★채점 오라클
out/                results.json(전체 트레이스), reliability.json(40회 측정)
```

## 읽을 때 주의할 것

- **`data-behavior` 는 픽스처 전용이다.** 변종 5개가 `_app.js` 하나를 공유하려고 붙인 앵커다.
  스냅샷에서 제거되고, 녹화본에 새면 `run-poc.mjs` 가 실행을 중단한다. 리졸버는 이걸 볼 수 없다 —
  안 그러면 이 실험은 통째로 무의미해진다.
- **채점은 재생기가 하지 않는다.** `lib/replay.mjs` 의 오라클이 위 앵커를 읽어
  "값이 맞는 칸에 들어갔는지" 까지 본다. 제출은 됐는데 딴 칸에 적힌 경우를 `SILENT-CORRUPTION` /
  `FAIL-DIRTY` 로 따로 구분하는 이유다. 정산 화면에서 제일 비싼 실패가 그거다.
- **모델 폴백은 결정적이지 않다.** 40회 중 1회 `NONE` 이 나왔다. 재시도와 단계별 `verify` 가
  옵션이 아니라 필수인 이유다.
