#!/bin/bash
# TaskForce.AI — UserPromptSubmit Hook
# 상시 모드 파일이 있으면 강제 지시, 없으면 약한 리마인더

MODE_FILE="$HOME/.claude/taskforce-mode.json"

if [ -f "$MODE_FILE" ]; then
  PROJECT=$(cat "$MODE_FILE" | grep -o '"project":"[^"]*"' | cut -d'"' -f4)
  cat <<HOOK
[TaskForce 상시 모드 ON — 프로젝트: ${PROJECT}]
⛔ 필수: 코드를 수정/생성/삭제하기 전에 반드시 TaskForce MCP 티켓을 확인하거나 생성하세요.
- 관련 태스크 있으면: add_activity로 기록 후 작업
- 관련 태스크 없으면: create_task로 생성 후 작업
- 단순 질문/읽기만: 티켓 불필요
- 작업 완료 시: submit_for_review 또는 update_task_status
- 절대 Claude Code 내장 TaskCreate/TaskUpdate 사용 금지. TaskForce MCP 도구만 사용.
HOOK
else
  echo '[TaskForce MCP] 관련 태스크가 있으면 상태를 업데이트하고, 새 작업이면 티켓을 생성하세요.'
fi
