---
name: tf-fix
description: FAILED/BLOCKED 태스크를 진단하고 복구합니다
allowed-tools: Bash, Read, Glob, Grep, Write, Edit
---

FAILED 또는 BLOCKED 상태의 태스크를 진단하고 복구합니다.

## 단계

1. `get_all_tasks`로 FAILED / BLOCKED 태스크를 찾습니다.
2. 각 문제 태스크에 대해:
   a. `get_task_activities`로 활동 로그를 확인합니다 (실패 원인 파악).
   b. 원인을 분류합니다:
      - **환경 문제**: API 키 미설정, Docker 안 돌아감, 패키지 미설치
      - **코드 문제**: 에이전트가 작성한 코드 버그, 테스트 실패
      - **의존성 문제**: 선행 태스크가 아직 미완료
      - **스킬 문제**: 스킬 파일 규칙이 모호해서 에이전트가 잘못 해석
3. 원인에 맞는 해결책을 제시하고 실행합니다:
   - 환경 문제 → 설정 수정 후 `update_task_status`로 TODO(retry)로 되돌리기
   - 코드 문제 → 직접 수정 후 재시도 or 피드백 추가
   - 의존성 → 선행 태스크 먼저 처리
   - 스킬 → 스킬 파일 규칙 수정 제안
4. 복구 후 `add_activity`로 수정 내용을 기록합니다.

## 자주 나오는 FAILED 원인

- `.env` 파일에 API 키 빠짐
- Docker 컨테이너가 꺼져있음
- 패키지 버전 충돌
- 에이전트가 scope 밖 파일을 수정하려다 실패
