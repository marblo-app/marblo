# Rate-Limit Capture — 정식 status 소스 (Phase 1b)

에이전트별 구독 rate-limit(5h primary / 7d weekly)을 **CLI가 공식적으로 보고하는
값**으로 채우는 파이프라인 정리. 추정치·PTY 스크래핑·스테일 값은 쓰지 않는다.

## 소스 매트릭스

| CLI                  | 정식 소스                                              | 캡처 방식                                     | 스코프                          |
| -------------------- | ------------------------------------------------------ | --------------------------------------------- | ------------------------------- |
| codex                | rollout JSONL `event_msg/token_count` 의 `rate_limits` | 세션 파일 폴링 (기존, session-parsers.ts)     | 계정 전역 값이 세션 파일에 실림 |
| claude               | SDK control protocol `get_usage` 응답의 `rate_limits`  | 헤드리스 프로브 (신규, claude-usage-probe.ts) | 계정 전역 (probe 1개 공유)      |
| gemini / antigravity | 없음                                                   | —                                             | 정보 없음 처리                  |

## Codex (검증 결과 — 변경 없음)

- codex CLI 에는 status/usage 서브커맨드가 **없다** (`codex --help` 기준 `doctor` 만 존재).
  rollout JSONL 파싱이 정식 경로가 맞다.
- 실파일 검증 (`~/.codex/sessions/**/rollout-*.jsonl`):

  ```json
  "rate_limits": {
    "primary":   { "used_percent": 1.0,  "window_minutes": 300,   "resets_at": 1780650953 },
    "secondary": { "used_percent": 15.0, "window_minutes": 10080, "resets_at": 1781149096 },
    "plan_type": "plus"
  }
  ```

  `window_minutes` 300/10080 = 5h/7d, `resets_at` 는 epoch 초.
  `session-parsers.ts::parseCodexCumulative` 가 이 형태를 그대로 매핑하고 있어
  (primary→`rateLimitPercent`, secondary→`rateLimitWeeklyPercent`) 정확히 surface 된다.

## Claude (Phase 1b — 신규)

### 리서치 결론 (claude CLI 2.1.172 실증)

1. **세션 JSONL 에는 rate-limit 이 전혀 없다.** 기존 claude 경로는 `rateLimit: null`
   이었다 (부정확한 값이 아니라 값 자체가 없었음).
2. **statusline JSON 에는 있다** — stdin 으로 `rate_limits.five_hour/seven_day`
   (`used_percentage`, `resets_at`)를 받는다 (바이너리 내장 스키마 문서로 확인).
   하지만 statusline 은 **인터랙티브 TUI 전용**: `-p/--print` 모드에서는
   `--settings` 로 statusLine command 를 주입해도 한 번도 호출되지 않는다 (실측).
3. **`~/.claude` 캐시에는 실사용량이 없다** (`~/.claude.json` 에 tier 명만,
   `stats-cache.json` 은 메시지 카운트만).
4. `claude -p --output-format json` 결과에도 rate_limits 없음.
5. ★ **정식 헤드리스 경로: SDK control protocol 의 `get_usage` 요청.**

   ```
   → {"type":"control_request","request_id":"…","request":{"subtype":"get_usage"}}
   ← {"type":"control_response","response":{"subtype":"success","request_id":"…",
       "response":{"subscription_type":"max","rate_limits_available":true,
         "rate_limits":{
           "five_hour":{"utilization":23,"resets_at":"2026-06-11T06:00:00+00:00"},
           "seven_day":{"utilization":16,"resets_at":"2026-06-12T06:00:00+00:00"}, …}}}}
   ```

   - 대화 메시지를 보내지 않아도 즉시(~1초) 응답한다. 모델 호출 0,
     `total_cost_usd` 0 — **토큰/쿼터를 소비하지 않는다.**
   - `claude -p --input-format stream-json --output-format stream-json --verbose`
     로 띄우고 위 한 줄을 stdin 에 쓰면 끝. 응답 수신 후 프로세스 kill.
   - 격리 플래그: `--setting-sources "" --strict-mcp-config --mcp-config '{"mcpServers":{}}' --no-session-persistence --disable-slash-commands`
     → 훅/MCP/세션파일 부작용 없음. cwd 는 tmpdir.

### 아키텍처

```
CostTracker
 ├─ claude tracker 1개 이상 존재하는 동안:
 │    5분 주기 → probeClaudeUsage(resolveClaudeBinary().command)
 │    → ClaudeUsageSnapshot { primary/secondary percent + resetAt(epoch s), planType, capturedAt }
 │    (계정 전역 — 모든 claude 에이전트가 같은 ~/.claude 인증 공유)
 └─ pollSessionFile(15s tick, claude format):
      freshClaudeRateLimit() — 15분(3폴) 이내 스냅샷만 → emit()
      → 기존 rateLimitPercent / rateLimitWeeklyPercent(+ResetAt) 파이프(#58)로 전달
```

### 죽은/스테일 값 처리

- 프로브 실패(타임아웃·에러응답·spawn 실패) → `null` = **정보 없음**. 0 으로
  쓰지 않고, 기존 필드를 덮어쓰지도 않는다.
- 스냅샷이 15분(3 폴 주기)보다 오래되면 stale 로 간주, emit 하지 않는다.
- 3회 연속 실패 시 30분 백오프 (구버전 CLI 에 get_usage 가 없을 수 있음 —
  에러 control_response 로 즉시 감지).
- `rate_limits_available: false` (API key / Bedrock / Vertex 인증) → 플랜
  리밋이 적용되지 않는 모드이므로 정보 없음 처리.

### 주의

- `get_usage` 는 upstream 에서 **Experimental** 로 표기 (SDK 메서드명이
  `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET`). 응답 형태가
  바뀔 수 있어 `parseGetUsageResponse` 는 전부 방어적 파싱 — 예상 밖 형태는
  null. CLI 업데이트 후 프로브가 조용히 '정보 없음' 으로 떨어질 수 있으니
  Usage 탭에 claude 값이 사라지면 이 파서부터 점검할 것.
- statusline 주입 방식은 인터랙티브 PTY 세션에서만 동작하므로 채택하지 않았다.
  (스폰된 에이전트 PTY 에 statusline 을 주입하면 사용자 설정 statusline 을
  덮어쓰는 부작용도 있다.)
