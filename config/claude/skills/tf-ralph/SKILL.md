---
name: tf-ralph
description: Ralph 패턴으로 반복 작업을 티켓 단위로 추적하며 일괄 처리합니다
allowed-tools: Bash, Read, Glob, Grep, Write, Edit
---

Ralph 패턴으로 반복 작업을 TaskForce 티켓과 함께 처리합니다.

## 사용법

사용자에게 다음을 물어보세요:
1. **대상**: 어떤 파일/컴포넌트/엔드포인트를 반복 처리할 것인지
2. **작업**: 각 대상에 어떤 작업을 할 것인지 (테스트 추가, 리팩토링, a11y 개선 등)
3. **프로젝트 이름**: TaskForce 티켓에 사용할 프로젝트명

## 워크플로우

1. 대상 파일/컴포넌트를 분석해서 목록을 만듭니다.
2. `create_tasks_bulk`로 대상 1개당 티켓 1장을 생성합니다:
   - title: "[작업유형] 대상명" (예: "[테스트] /api/users")
   - role: 작업에 맞는 역할
   - priority: 동일하게 설정
3. 티켓을 하나씩 순서대로 처리합니다:
   a. `claim_task` → `update_task_status(start_work)`
   b. 실제 작업 수행
   c. `add_activity`로 결과 기록 (예: "pytest 3개 작성, 3/3 pass")
   d. 성공: `submit_for_review` → `update_task_status(DONE)`
   e. 실패: `update_task_status(FAILED)` + 실패 원인 기록
4. 모든 티켓 처리 완료 후 결과 요약:
   - DONE: N개
   - FAILED: N개
   - 실패한 항목의 원인

## Ralph vs Agent Teams

- **Ralph**: 동일한 작업을 N개 대상에 반복. 1개 에이전트가 순차 처리.
- **Agent Teams**: 서로 다른 작업을 병렬 처리. N개 에이전트가 협업.
