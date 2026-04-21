---
name: tf-agent
description: Claude Code 내부 논리적 서브에이전트를 스폰합니다. 빠른 조사/탐색에 적합합니다.
allowed-tools: Bash, Read, Glob, Grep, Write, Edit
---

# Marblo 논리 에이전트 (서브에이전트)

> Claude Code 내부에서 실행되는 논리적 서브에이전트를 스폰합니다.
> Electron 터미널 탭 없이, 같은 세션 내에서 병렬 작업을 수행합니다.

---

## /tf-agent vs /tf-spawn 차이

| | /tf-agent (이 명령어) | /tf-spawn |
|--|---------------------|-----------|
| 실행 위치 | Claude Code 내부 | Electron 독립 터미널 탭 |
| 속도 | 빠름 (즉시 시작) | 보통 (PTY 생성 필요) |
| 컨텍스트 | 현재 대화 컨텍스트 공유 | 독립 (스킬 파일로 시작) |
| 모델 | Claude (sonnet/haiku/opus) | Claude, Gemini, GPT |
| 용도 | 빠른 조사, 탐색, 일회성 작업 | 장시간 독립 코딩 |
| 칸반 연동 | 없음 | 카드 클릭 → 터미널 |

---

## 사용 시나리오

### 1. 빠른 코드 탐색
```
/tf-agent "이 프로젝트에서 인증 관련 파일들을 찾아서 구조를 정리해줘"
```
→ Explore 타입 서브에이전트가 코드베이스를 탐색

### 2. 병렬 조사
```
/tf-agent "React 19의 Server Actions 패턴을 조사해줘"
```
→ 메인 작업과 병렬로 리서치 수행

### 3. 일회성 코드 수정
```
/tf-agent "테스트 파일 3개의 import를 새 경로로 업데이트해줘"
```
→ general-purpose 에이전트가 파일 수정

---

## 동작 방식

1. 사용자가 `/tf-agent "프롬프트"` 입력
2. Claude Code의 내장 `Task` 도구로 서브에이전트 스폰
3. 서브에이전트가 작업 수행 후 결과 반환
4. 결과를 메인 대화에 요약

### 에이전트 타입 자동 선택

| 작업 유형 | 서브에이전트 타입 |
|----------|-----------------|
| 파일 탐색, 코드 검색 | `Explore` |
| 구현 계획 수립 | `Plan` |
| 코드 수정, 파일 생성 | `general-purpose` |

---

## Marblo MCP 연동

서브에이전트도 Marblo MCP 도구를 사용할 수 있습니다:
- `get_all_tasks` — 태스크 현황 확인
- `add_activity` — 진행 상황 기록
- `search_tasks` — 태스크 검색

단, 서브에이전트에서는 `spawn_agent`를 호출하지 않습니다.
물리적 에이전트 스폰이 필요하면 `/tf-spawn`을 사용하세요.

---

## 주의사항

- 서브에이전트는 일시적 — 작업이 끝나면 사라짐
- 대규모 코딩 작업에는 `/tf-spawn`으로 물리 에이전트를 사용
- 동시에 여러 서브에이전트를 스폰하면 컨텍스트 윈도우를 많이 소비할 수 있음
