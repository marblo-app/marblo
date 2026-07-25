# 스킬 전달·지정·검증 런북 (라우팅 Phase 4)

> 티켓 `Nsp8lyOskFAdaHYfNFzY` 산출물. 선행 설계 = `INTELLIGENT-ROUTING-PLAN.md` §D.
> 작성 2026-07-25. 이 문서의 모든 수치는 이 Mac 에서 실제로 측정한 값이다.

---

## 0. 한 줄 요약

스킬은 **원래도 전달되고 있었다**(env 상속). 없던 것은 **지정·검증·관측** 세
가지다. 그래서 이번 변경은 새 전달경로가 아니라 `dispatch_task(skills[])` 라는
**지정 파라미터 + 디스크 실측 검증 게이트 + 사용 관측 규약**이다.
그리고 codex 는 사용자 스킬이 0개라 지정 자체가 무의미했으므로, **codex 설치
경로를 런북화**했다(실행은 사장님 승인 대기 — §4).

---

## 1. 마블로에는 이름이 같은 두 개의 스킬 층이 있다

혼선의 근원이라 먼저 분리한다. **둘 다 유지한다.** 근거는 아래 표.

| 층                    | 실체                                                                          | 전달 방식                                                 | 누가 지정하나                       |
| --------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------- |
| **역할 스킬**         | `skills/backend_agent.md` 등 (marblo 저장소)                                  | `composeInitialPrompt` 이 **프롬프트에 텍스트로 prepend** | marblo (스폰 시 role 로 자동)       |
| **CLI 네이티브 스킬** | `~/.claude/skills/*` (91개) · `$CODEX_HOME/skills/*` (사용자 0 + `.system` 6) | CLI 가 **자기 홈에서 스스로 발견**                        | 지금까지 아무도 못 했다 → 이번 변경 |

### 왜 역할 스킬을 네이티브로 "대체" 하지 않는가

사장님 지시는 "tf 스킬도 설치돼서 쓰이는 게 깔끔하다" 였고, **tf 스킬은 그렇게
했다**(§4). 하지만 역할 스킬의 prepend 층은 그대로 둔다. 근거:

1. **네이티브 스킬은 모델이 호출해야 로드된다.** 역할 스킬은 그 에이전트의
   워크플로 전체를 규정하므로 "모델이 부르면 로드" 는 계약이 약하다. prepend 는
   전달이 100% 보장된다.
2. **네이티브 스킬이 없는 벤더가 있다.** antigravity·gemini 는 스킬 개념 자체가
   없다(`vendorForModel` → null). prepend 를 걷어내면 그 벤더의 워커는 역할
   규약을 통째로 잃는다.
3. **관측 비용이 0이다.** prepend 는 우리가 만든 문자열이라 무엇이 갔는지 안다.

→ **결론: 역할 스킬 = prepend(유지), tf·공용 스킬 = CLI 네이티브(설치).**
중복은 없다. 두 층은 서로 다른 것을 나른다.

---

## 2. 실측 근거 (추측 아님)

### 2-1. codex 는 `$CODEX_HOME/skills` 를 네이티브로 읽는다

`codex debug prompt-input` 은 **모델에게 실제로 보내지는 프롬프트**를 JSON 으로
찍는다. 모델 호출도 네트워크도 없다 — 스킬 로딩 여부를 확인하는 가장 싼 관측점.

```bash
# 스크래치 홈에 tf 스킬 22개를 설치한 뒤
CODEX_HOME=/tmp/probe/.codex codex debug prompt-input | grep -o 'tf-[a-z-]*:' | sort -u
#   → tf-add: tf-agent: ... tf-work:   (22개 전부 <skills_instructions> 에 로드)

# 실제 홈(사용자 스킬 0개)
codex debug prompt-input | grep -c 'tf-start'
#   → 0
```

**판정: codex 0.145 는 `$CODEX_HOME/skills/<name>/SKILL.md` 를 네이티브 스킬로
읽는다.** (교차근거: `~/.codex/skills/.system/skill-installer/SKILL.md` 원문 —
"Installs into `$CODEX_HOME/skills/<skill-name>`".)

### 2-2. claude 는 이미 상속된다

`INTELLIGENT-ROUTING-PLAN` §D 실측 — 중립 cwd 에서 스폰한 `claude -p` 가
사용자 스킬 88개(현재 91개)를 전부 나열했다. 이번 변경으로 바뀌지 않는다.

### 2-3. 오타는 조용히 무효였다

사장님이 쓰신 `/seo-geo-optimization` 은 존재하지 않는다. 실제 설치명은
`seo-geo-full`. 지금까지는 그 이름을 지시문에 적어도 아무 에러 없이 그냥 무시됐다.

---

## 3. `dispatch_task(skills[])` 계약

```jsonc
dispatch_task({
  role: "frontend",
  instruction: "랜딩 SEO 보강",
  skills: ["seo-geo-full"],   // ← 신규
})
```

동작 순서:

1. **MCP 선검증** (`tools.ts`) — 이름 문법 + 어느 벤더에든 설치돼 있는가.
   실패하면 **미션 태스크 생성·의존성 게이트 같은 부수효과가 일어나기 전에**
   에러를 돌려준다. 오타 한 글자로 보드에 쓰레기 티켓이 남지 않게 하려는 것.
2. **bridge 벤더 게이트** (`bridge-server.ts`) — 실제 선택될 모델의 벤더에 그
   스킬이 있는지 다시 본다(단일 진실은 디스크). 여기서 세 경로를 전부 막는다:
   - 명시 모델의 벤더에 미설치 → 실패
   - 스킬 없는 벤더의 **유휴 에이전트 재사용** → 후보에서 제외
   - 스킬 없는 벤더로의 **신규 스폰** → 후보 모델에서 제외, 후보 0이면 실패
3. **지시문 주입** — 통과하면 지시문 맨 앞에 지정 블록이 붙는다.
   (스킬 미지정이면 지시문은 바이트 단위로 그대로 — 무회귀.)

### 에러는 항상 명시적이다

```
Dispatch aborted (skills): 지정 스킬 [seo-geo-optimization] 이 어떤 벤더에도 설치돼
있지 않다 — claude: 'seo-geo-optimization' — 혹시 이것? seo-geo-full (설치 91개) |
codex: 'seo-geo-optimization' (설치 6개).
설치: `bash scripts/install-agent-skills.sh --vendor <claude|codex>`
```

이름 문법 위반(`../../etc/passwd`, `skill; rm -rf /` 등)은 디스크를 보기 전에
거부한다 — `run_skill` 의 allowlist·메타문자 차단 규율을 그대로 계승했다.

### 지원 벤더

| 모델                           | 스킬 벤더 | 비고                                                                           |
| ------------------------------ | --------- | ------------------------------------------------------------------------------ |
| `claude`                       | claude    | `~/.claude/skills` + 프로젝트 `.claude/skills` + 플러그인 캐시(`plugin:skill`) |
| `gpt` / `codex`                | codex     | `$CODEX_HOME/skills` + `.system`                                               |
| `antigravity`/`gemini`/`local` | —         | 네이티브 스킬 개념 없음 → **스킬 지정 시 차단**(조용한 무효 금지)              |

---

## 4. 설치 런북 — `scripts/install-agent-skills.sh`

★**사용자 홈을 만지는 스크립트다. 기본이 DRY-RUN 이고, 실제 쓰기는 `--apply`
를 줘야 한다.** 우리가 설치하는 이름(`tf-*`) 밖의 파일은 절대 건드리지 않는다.

```bash
bash scripts/install-agent-skills.sh --list              # 현황만 본다
bash scripts/install-agent-skills.sh                     # dry-run (무해)
bash scripts/install-agent-skills.sh --vendor codex --apply   # ← 권장 첫 실행
bash scripts/install-agent-skills.sh --dest-codex /tmp/x --apply  # 스크래치 검증
```

- **멱등**: 내용이 같으면 아무것도 하지 않는다(재실행 안전).
- **백업**: 내용이 다르면 덮기 전에 `SKILL.md.bak-<타임스탬프>` 를 남긴다.
- **codex 변환**: claude 전용 frontmatter(`disable-model-invocation`,
  `allowed-tools`, `argument-hint`)를 걷어내고 `name`/`description` 만 남긴다.
  본문은 손대지 않는다.

### 실행 상태 (2026-07-25 기준)

| 대상       | 상태                                                                                                                                                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **codex**  | ⏸ **사장님 승인 대기**. dry-run 결과 = tf 22개 전부 신규 설치(순수 추가, 덮어쓰기 0).                                                                                                                                  |
| **claude** | ⏸ **승인 대기 + 주의**. 홈의 `tf-*` 22개가 **repo 판과 내용이 전부 다르다**(홈=영문, repo=한글). `--apply` 하면 사장님이 실사용 중인 스킬이 repo 판으로 교체된다(백업은 남음). **codex 만 먼저 적용하는 것을 권한다.** |

> 검증은 이미 끝났다: 스크래치 dest 로 `--apply` 를 실제 실행해 22개 신규 설치 →
> 재실행 시 "동일 22" (멱등) 를 확인했고, 그 홈으로 `codex debug prompt-input`
> 이 22개를 전부 로드하는 것을 §2-1 처럼 측정했다. 남은 것은 **실제 홈에 적용할지
> 여부** 뿐이며, 그건 사장님 결정이다.

---

## 5. 사용 검증 신호 (P4-2)

"스킬을 정말 썼는가" 는 지금까지 신호가 **0** 이었다. 이번에 (중) 신뢰도 신호를
넣었다 — 지시문에 다음 규약이 자동 주입된다:

```
[skill] seo-geo-full invoked          ← 호출 직후 add_activity 로 1줄
[skill] seo-geo-full skipped — 이유    ← 안 쓰기로 했으면 침묵 말고 명시
```

`parseSkillUsageMarkers()` (skill-registry.ts) 가 이 마커를 기계적으로 읽는다.
자기보고라 위조는 가능하지만(그래서 '중'), **침묵과 명시적 불사용을 구분**할 수
있게 된 것이 핵심이다.

(상) 신뢰도 신호 — 스킬 산출물 파일 존재 검사(`seo-geo-full` → `lib/schema.ts`,
`app/sitemap.ts`) — 는 스킬마다 산출물 목록이 필요해 이번 범위에서 제외했다.
후속 티켓 후보.

---

## 6. 회귀 검증법

```bash
# 유닛 (스킬 레지스트리 25 + dispatch 게이트 8)
cd v3 && npx vitest run tests/unit/skill-registry.test.ts tests/unit/bridge-dispatch-skills.test.ts

# 타입
cd v3 && npm run typecheck

# ★실호출 — 빌드된 dist-mcp 에 직접 JSON-RPC (앱 재시작 불필요, 비파괴)
cd v3 && npm run build:mcp
#   MARBLO_BRIDGE_PORT=1 로 띄우고 tools/call dispatch_task 를 4번 친다:
#     오타명   → "Dispatch aborted (skills) ... 혹시 이것? seo-geo-full"
#     경로주입 → "허용 문법이 아니다"
#     정상명   → 검증 통과 후 "Failed to reach bridge server" (= 게이트 통과 증거)
#     미지정   → 위와 동일 (무회귀 대조군)
```

★**앱 재시작 전까지 라이브 오케는 구 dist-mcp 를 물고 있다**(메모
`merged_vs_working_liveness_verification`). 머지 후 `npm run sync` + 앱 재시작을
해야 오케의 `dispatch_task` 에 `skills` 파라미터가 실제로 보인다.
