# dispatch_task /browse skill audit (2026-08-24)

## 결론

리포터 진단은 전제가 틀렸다. `/browse` 는 PATH 실행파일이 아니라 Claude Code
스킬이다. 설치 기준도 `which browse` 가 아니라
`~/.claude/skills/browse/SKILL.md` 존재 여부다.

따라서 Claude 이외 벤더에 “사장님 전역 규칙의 `/browse` 를 지켜라”를 그대로
위임하면 구조적으로 보장할 수 없다. gpt/codex, grok, antigravity 워커는 Claude
Code의 `~/.claude/skills/browse`를 실행하지 않는다.

## 경로 전수

### 1. `dispatch_task(skills=[...])`

이 경로는 이미 막혀 있다.

- MCP 계층: `v3/electron/mcp-server/tools.ts` 의 `dispatch_task`는 보드
  side effect 전에 `resolveSkillRouting({ skills, cwd })` 를 호출한다.
- Bridge 계층: `v3/electron/bridge-server.ts` 는 실제 스폰/재사용 후보에 대해
  같은 `resolveSkillRouting` 결과로 벤더 하드 게이트를 다시 건다.
- 레지스트리: `v3/electron/mcp-server/skill-registry.ts` 는 벤더별
  `skills/<name>/SKILL.md`만 발견한다. `gpt`/`codex` 는 Codex 홈,
  `grok` 은 Grok 홈, `claude` 는 Claude 홈이다.

즉 `dispatch_task(skills=["/browse"], model="gpt")` 같은 호출은
`browse` 가 Claude에만 설치돼 있으면 스폰 전에 실패한다. 이 계약은
`v3/tests/unit/skill-registry.test.ts` 의 `/browse` 회귀 테스트가 고정한다.

### 2. `dispatch_task(instruction="... /browse ...")`

이 경로에는 일부러 `skills` 검증이 닿지 않는다. `instruction` 은 워커에게
전달하는 자유 텍스트이며, Slash command 전체를 파싱해 실행 가능성을 판정하는
계약이 아니다.

그래서 “본문에 `/browse`가 언급됐는데 gpt/grok 에이전트가 받았다”는 현상은
`skills` 게이트 누락이 아니라 입력 표면이 다르기 때문이다. 이 경우
`resolveSkillRouting` 은 호출되지 않는다.

### 3. Claude 워커 prefix diet

`v3/electron/prefix-diet.ts` 는 Claude 워커에서 slash command 목록 제거가 능력
손실을 낼 수 있음을 이미 명시하고, `MARBLO_WORKER_SKILLS=off` 명시 설정이
있을 때만 `--disable-slash-commands` 를 켠다. `/browse` 는 이 “Claude slash
skill” 범주에 속한다.

### 4. `run_skill`

`v3/electron/mcp-server/tools.ts` 의 `run_skill` 은 미션 엔진용 allowlist
서브프로세스 실행 경로다. 이 경로는 `dispatch_task` 워커 스폰 라우팅이 아니고,
`instruction` 본문의 `/browse` 문자열을 자동으로 해석하지 않는다.

## 운영 답변

스킬이 필요한 작업을 물리 워커에 맡길 때는 자연어 본문에 `/browse`를 쓰는 대신
`dispatch_task(skills=["browse"], model="claude", ...)` 처럼 `skills` 인자를
써야 한다. 그러면 미설치 스킬은 에러가 되고, 설치 벤더가 아닌 모델로는 라우팅되지
않는다.

비-Claude 벤더에 같은 작업을 맡겨야 한다면 `/browse` 사용 규칙을 그대로 전달할 수
없다. 해당 벤더가 가진 별도 브라우징/리서치 수단을 명시하거나, 브라우징 단계만
Claude로 분리해야 한다.
