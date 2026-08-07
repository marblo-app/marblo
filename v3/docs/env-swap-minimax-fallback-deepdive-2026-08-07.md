# env-swap 벤더 모델 폴백 딥다이브 (MiniMax)

> **진단 전용** · 코드 변경 없음 · task `JPXffA0HvGYINVCA6kua` · 2026-08-07
>
> 증상: `dispatch_task(model="minimax")` 인데 antigravity/gpt 가 스폰됨.
> 세션 초반 `MiniMax-M2.7` 성공 → 앱 재시작 후 폴백. `MINIMAX_API_KEY` 는 환경에 있음.

---

## 0. 한 줄 결론

| 항목 | 결론 |
|------|------|
| **폴백 정확 지점** | `bridge-server.ts` `dispatchSingle` — `resolveModelPin("minimax")` 가 `undefined` 를 반환 → explicit model 소실 → 태그 스코어링/idle reuse |
| **근본 원인** | `model="minimax"` 는 **VendorId** 이지 레지스트리 **모델 id/alias 가 아님**. MiniMax 행의 `aliases: []` 이고 loose key 도 `minimaxm3`/`minimaxm27` 만 존재. 벤더 숏핸드 해석 경로 없음. |
| **재시작 후 env-swap 등록 유실 가설** | **기각(reject)**. MiniMax/GLM/Kimi 는 정적 `MODEL_REGISTRY` 행. 런타임 등록·재시작 유실은 **Ollama local 전용**. |
| **antigravity/gpt 로 보이는 이유** | pin 실패 시 `model === undefined` → 기존 idle 에이전트 reuse 또는 preset 스코어링이 agy/gpt 를 고름 (키 없음 게이트 경로가 아님). |
| **영향 범위** | `model="zai"|"glm"|"kimi"|"moonshot"|"minimax"` 등 **벤더 이름만** 넣는 모든 env-swap 호출이 동일 실패모드. 구체 id(`MiniMax-M2.7`, `glm-5.2`, `k3`)는 정상. |

---

## 1. 전달 경로 (model → spawn)

```
MCP dispatch_task(model=…)
  └─ electron/mcp-server/tools.ts  (model 문자열 그대로 bridge POST)
       └─ BridgeServer.dispatchSingle
            ├─ joinModelAndEffort(params.model, params.effort)
            ├─ resolveModelPin(modelSpecInput)          ← ★해석 단일 창구
            │     └─ parseModelSpec → findModelLoose / normalizeModel
            ├─ requestedModel = resolvedPin?.harness ?? normalizeModel(…)
            ├─ modelPin = { claudeModel|codexModel|nativeModel }  or undefined
            └─ reuse / score / spawnNewAgent({ model, modelPin })
                 ├─ vendorEnvReadiness(pinnedModelId)   ← 키 없으면 spawn 차단
                 └─ agentManager.launch → applyVendorEnv(env, claudeModel)
```

관련 파일:라인:

| 단계 | 파일:라인 | 역할 |
|------|-----------|------|
| MCP 스키마 | `mcp-server/tools.ts` ~4769–4783 | `model` optional string; 미등록 id 는 “무시 + 스코어링 폴백” 문서화 |
| pin 해석 | `model-selection.ts:190` `parseModelSpec`, `:262` `resolveModelPin` | 레지스트리 조회 + harness/vendor 파생 |
| 프로바이더 접기 | `dispatch-scoring.ts:557` `MODEL_ALIASES`, `:574` `normalizeModel` | harness 토큰만 (`claude`/`codex`/`gpt`/`agy`…). **벤더 id 없음** |
| dispatch | `bridge-server.ts:2088–2107` | pin → `requestedModel` / `modelPin`; pin 실패 시 `model` 비움 |
| spawn 초크포인트 | `bridge-server.ts:3168+` `spawnNewAgent` | `normalizeModel` 재적용; env-swap 크레덴셜 게이트 `:3207–3221` |
| 벤더 env 주입 | `agent-config.ts:1263` `applyVendorEnv` | 키 없으면 프로파일 전체 미주입(전부-아니면-전무) |
| 정적 레지스트리 | `model-registry.ts:620–669` MiniMax 행 | `harness:"claude"`, `provider:"minimax"`, `aliases:[]` |
| 런타임 등록(local only) | `model-registry.ts:1041–1073` `registerLocalOllamaModels` | Ollama 실측 id 만 BY_ID 에 합류 |
| 재시작 동기화(local) | `main.ts` `agent:launch` ~5539–5544 | `syncInstalledLocalModels` — **local 핀일 때만** |
| dotenv | `main.ts:225` | 부팅 1회 `v3/.env` 로드 |
| 키 2차 소스 | `vendor-secrets.ts` | `~/.marblo/vendor-secrets.enc.json` (패키지앱/UI) |

문서 정본 (사용법):

- `v3/docs/VENDOR-MINIMAX.md` §2: `model="MiniMax-M3"` / `model="minimax-m3"` 만 예시.
- `v3/docs/VENDOR-MODEL-USAGE-GUIDE.md` §3: 동일. **`model="minimax"` 는 문서에도 없음.**

---

## 2. (1) `model="minimax"` 해석·폴백 정확 지점

### 2.1 해석 결과 (로직 프로브)

| 입력 | getModel / loose | normalizeModel | resolveModelPin |
|------|------------------|----------------|-----------------|
| `minimax` | miss (`looseKey=minimax`, index 에 없음) | `undefined` | **`undefined`** |
| `MiniMax-M2.7` / `minimax-m2.7` | hit → `MiniMax-M2.7` | n/a (entry 우선) | harness=`claude`, vendor=`minimax`, claudeModel=`MiniMax-M2.7` |
| `MiniMax-M3` / `minimax-m3` | hit | | harness=`claude`, vendor=`minimax` |
| `glm` / `zai` | miss | undefined | undefined |
| `glm-5.2` | hit | | harness=`claude`, vendor=`zai` |
| `kimi` / `moonshot` | miss | undefined | undefined |
| `k3` | hit | | harness=`claude`, vendor=`moonshot` |

loose index 키 (env-swap 관련): `minimaxm3`, `minimaxm27`, `glm52`, `glm47`, `k3`, …  
→ **벤더 이름 단독 키 없음.**

근거:

- MiniMax 행 `aliases: []` (`model-registry.ts` 634, 661).
- `looseKeysFor` 는 id/alias/harness 프리픽스 제거형만 등록 (`model-selection.ts:119–137`).  
  harness 가 `claude` 이라 `MiniMax-M3` → bare 그대로 → `minimaxm3` 만 생김. `minimax` 미생성.
- `normalizeModel` 은 harness alias 표만 본다 (`dispatch-scoring.ts:557–580`). `minimax` 미포함.

### 2.2 dispatch 에서의 “조용한 폴백”

`bridge-server.ts:2088–2097`:

```text
resolvedPin = resolveModelPin("minimax")  → undefined
requestedModel = undefined ?? normalizeModel("minimax") → undefined
model = undefined   // explicit model 소실
modelPin = undefined
```

이후:

1. **Reuse** (`:2266` `modelMatches = !model || m === model`): `model` 이 비면 **모든 하네스** idle 에이전트 후보.  
   이미 떠 있는 antigravity/gpt 가 role 매칭되면 재사용 → 증상과 일치.
2. **Spawn 스코어링** (`:2591+`): explicit model 없으면 `scoreModelsDetailed` / preset(`MARBLO_MODEL_PRESET` 등)이 claude/gpt/antigravity 중 선택.
3. **로그 관점**: 이 경로는 “지정 모델 폴백” warn 이 아니라 **명시 지정 자체가 없었던 것**과 동일. MCP 설명문도 “목록에 없는 id는 무시되고 기존 스코어링으로 폴백”이라고 이미 적혀 있음 (`tools.ts` model describe).

### 2.3 키 없음 경로와 구분 (오진 방지)

| 조건 | 결과 |
|------|------|
| pin 성공 + `MINIMAX_API_KEY` 없음 | `spawnNewAgent` 가 **차단** (`vendor credentials` error, `:3211–3220`). antigravity 로 갈아타지 않음. |
| pin 실패 (`minimax`) | 스코어링/reuse → **다른 하네스 스폰 가능**. 키가 있어도 무관. |
| pin 성공 + 키 있음 | claude 바이너리 + MiniMax env (`applyVendorEnv`). |

증상 “antigravity/gpt 스폰” 은 **키 유실이 아니라 pin 해석 실패** 쪽과 정합.

### 2.4 세션 초반 MiniMax-M2.7 성공과의 정합

- 성공 사례는 구체 id(`MiniMax-M2.7`) 사용 시 pin 성공 경로.
- 재시작 후 `model="minimax"` (벤더 숏핸드/오케 오해) 를 쓰면 pin 실패 → 폴백.
- **재시작이 레지스트리를 지운 것이 아니라**, 호출 문자열이 달라진(또는 원래부터 숏핸드였던) 케이스로 설명 가능.

---

## 3. (2) model-registry env-swap · 런타임 등록 · launch 핀게이트 · 재시작

### 3.1 env-swap 프로파일이 스폰 시 조회되는가?

**예 — 단, 구체 모델 id 로 pin 이 잡힌 뒤에만.**

1. `resolveModelPin("MiniMax-M2.7")` → `claudeModel: "MiniMax-M2.7"`, `vendor: "minimax"`.
2. `spawnNewAgent` / `agent:launch` 가 `vendorEnvReadiness("MiniMax-M2.7")` 호출  
   → `envProfileForModel` → `ANTHROPIC_*` + `${MINIMAX_API_KEY}` 참조 해석.
3. `getLaunchConfig` / `applyVendorEnv` 가 같은 pinned id 로 프로파일 주입.

조회 축: 정적 `BY_ID`/`BY_ALIAS` (+ Ollama 런타임 행). **프로세스 재시작 후에도 정적 행은 모듈 로드 시 항상 재구축.**

### 3.2 재시작 후 env-swap 등록 유실 가설

| 가설 | 판정 | 근거 |
|------|------|------|
| MiniMax/GLM/Kimi 행이 재시작 후 BY_ID 에서 사라진다 | **REJECT** | 컴파일타임 `MODEL_REGISTRY` 배열; 부팅 시 맵 재구축. 런타임 unregister 없음. |
| Ollama local 이 재시작 후 핀 불가 | **부분 성립 (다른 축)** | `registerLocalOllamaModels` 는 메모리; `syncInstalledLocalModels` 가 다시 채움. launch 는 local 일 때만 사전 sync (`main.ts` ~5539). |
| dotenv 미로드로 키 유실 | **조건부** | dotenv 는 부팅 1회 (`main.ts:225`). 이 worktree 에는 `v3/.env` **없음**. 호스트에 `~/.marblo/vendor-secrets.enc.json` 의 키 이름 `MINIMAX_API_KEY` **존재**(값 미기록). 키가 없어도 증상은 “차단”이지 “agy 폴백”이 아님. |
| 오케 셀렉터에 MiniMax 가 없다 | **의도된 설계** | `selectorEligible` 이 네이티브 벤더만 통과 (`model-selection.ts:688–690`). 재시작 시 영구 저장 값이 키 없이 새는 것을 막기 위함. env-swap 은 **명시 dispatch 전용**. |

### 3.3 launch 핀게이트 (#678 관점)

`agent:launch` (`main.ts` ~5532–5576):

- `resolveModelPin(modelPin)` — dispatch 와 **동일 함수**.
- `pinApplies`: pin harness 가 `agent.model` 과 같거나, local→claude+vendor=local 예외.
- env-swap 은 `agent.model="claude"` + `modelPin="MiniMax-M2.7"` 이면 pin 적용 → 게이트가 Anthropic 대신 벤더 키를 봄 (`checkSpawnAuthGate` / `envSwapSpawn` in `harness-manager.ts:1189+`).

dispatch 경로에서 pin 자체가 없으면 이 게이트까지 **도달하지 않음** (이미 다른 하네스로 라우팅됨).

---

## 4. (3) GLM / Kimi / Z.ai 동일 영향

| 호출 | 결과 | 동일 버그? |
|------|------|------------|
| `model="minimax"` | pin miss → 스코어링 | **예** |
| `model="zai"` / `"glm"` | pin miss | **예** (벤더/브랜드 숏핸드) |
| `model="kimi"` / `"moonshot"` | pin miss | **예** |
| `model="glm-5.2"` / `"glm-4.7"` | pin hit, claude+zai | 정상 |
| `model="MiniMax-M2.7"` / `"minimax-m3"` | pin hit | 정상 |
| `model="k3"` / `"kimi-for-coding"` | pin hit | 정상 |

공통 구조:

- env-swap 행 전부 `aliases: []` (레지스트리).
- 벤더 이름을 모델 alias 로 올리는 코드 없음.
- `normalizeModel` 에 VendorId 매핑 없음.
- MCP/문서 권장 표기는 **구체 모델 id** 뿐.

---

## 5. 해법 제안 (구현은 후속 티켓 — 본 태스크는 진단만)

우선순위 높은 순.

### P0 — 조용한 무시 금지 (관측·안전)

1. **dispatch 시 미해석 model 을 스코어링으로 흘리지 말고 실패 또는 경고 고정**  
   - `params.model` 이 non-empty 인데 `resolveModelPin` 과 `normalizeModel` 둘 다 실패하면  
     `success:false, error: "Unknown model 'minimax'. Try MiniMax-M2.7 / MiniMax-M3 …"`  
   - 지금의 “목록에 없는 id 무시” 계약은 fable 이전 결함과 같은 클래스(조용한 무효).
2. **구조화 로그**: `requested_raw`, `resolved_pin`, `fallback_path=scoring|error`.

### P1 — 벤더 숏핸드 (UX)

3. **VendorId → 기본 모델 id** 해석 (단일 표, 레지스트리 파생 권장):  
   - `minimax` → capability 최고 active 행 (예: `MiniMax-M3`) 또는 문서 고정 기본값.  
   - `zai`/`glm` → `glm-5.2`, `moonshot`/`kimi` → `k3` 등.  
   - 구현 위치 후보: `parseModelSpec` 앞단 또는 `findModelLoose` 확장.  
   - `normalizeModel` 에 넣지 말 것 — 그건 harness 축; 벤더를 harness 로 접으면 축 분리 붕괴.
4. 또는 레지스트리 **aliases** 에 `"minimax"` 를 플래그십 행에만 부여 (충돌 테스트 필수: loose index).

### P2 — 문서·오케 가이던스

5. MCP `dispatch_task` model describe 에 벤더 숏핸드 비지원 명시 + 유효 id 예시.  
6. `VENDOR-*-` 런북에 “`model=minimax` 는 안 된다” 경고 한 줄.  
7. 오케 스킬/프롬프트: env-swap 은 구체 id 만.

### P3 — 키/재시작 혼동 완화

8. 키가 `.env` 에만 있고 패키지 앱이면 vendor-secrets 로 이전 안내(이미 UI 경로 존재).  
9. local(Ollama) 과 env-swap 을 같은 “등록 유실” 가설로 묶지 않도록 런북 구분.

### 비권장

- 키 없을 때 antigravity 로 폴백 — 현재도 안 함; 유지.
- 오케 영구 셀렉터에 MiniMax 노출 — `selectorEligible` 설계 의도 위반(재시작 시 네이티브 누수).

---

## 6. 검증 메모 (진단 시 수행)

- 유닛: `tests/unit/model-selection.test.ts` 54 pass (기존 스위트).
- 로직 프로브: loose index 키 집합 확인 (`minimax` miss / `minimaxm27` hit).
- 시크릿: 값 미출력. worktree `v3/.env` 부재; `~/.marblo/vendor-secrets.enc.json` 키 이름 `MINIMAX_API_KEY` 존재.

재현 (수동, 코드 변경 없이):

```text
# 실패 기대 (스코어링/reuse)
dispatch_task(..., model="minimax")

# 성공 기대 (키 있을 때 claude+MiniMax env)
dispatch_task(..., model="MiniMax-M2.7")
# 또는
dispatch_task(..., model="minimax-m2.7")
```

---

## 7. 영향 범위 요약

| 영역 | 영향 |
|------|------|
| 정적 레지스트리 / 빌드 | 재시작과 무관하게 MiniMax 행 유지 |
| dispatch 명시 지정 | 벤더 숏핸드만 깨짐; 구체 id OK |
| 자동 라우팅 사다리 | env-swap 은 `LADDER_EXCLUSIONS` 등으로 미편입(의도) — 본 버그와 별개 |
| 퀵레인 UI | 벤더 카탈로그로 구체 id 선택 → 정상 경로 |
| 오케 영구 모델 | env-swap 제외(의도) |
| GLM/Kimi | 동일 숏핸드 버그 |
| Ollama local | 별도 런타임 등록 축; 본 증상 주원인 아님 |

---

## 8. 권장 후속 티켓 (구현)

1. **backend/devops**: unknown explicit model → hard fail + 제안 id.  
2. **backend**: VendorId 숏핸드 → 플래그십 모델 해석 (테스트: loose collision 0).  
3. **docs**: 사용 가이드에 실패 예시 `model="minimax"` 명시.

---

*작성: DevOps agent · 코드 변경 0 · findings only.*
