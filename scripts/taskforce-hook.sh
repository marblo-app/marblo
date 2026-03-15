#!/bin/bash
# TaskForce.AI — UserPromptSubmit Hook
# 매 프롬프트마다 TaskForce MCP 사용을 강제합니다.

cat <<'HOOK'
[TaskForce MCP 필수]
⛔ 코드를 수정/생성/삭제하기 전에 반드시 TaskForce MCP 티켓을 확인하거나 생성하세요.
- 관련 태스크 있으면: add_activity로 기록 후 작업
- 관련 태스크 없으면: create_task로 생성 후 작업
- 단순 질문/파일 읽기: 티켓 불필요
- 작업 완료 시: submit_for_review 또는 update_task_status
- 절대 Claude Code 내장 TaskCreate/TaskUpdate 사용 금지. TaskForce MCP 도구만 사용.
HOOK
