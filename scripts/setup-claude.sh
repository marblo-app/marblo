#!/bin/bash
# TaskForce.AI - Claude Code 설정 스크립트
# 사용법: ./scripts/setup-claude.sh

set -e

CLAUDE_DIR="$HOME/.claude"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

mkdir -p "$CLAUDE_DIR"

# 1. Global CLAUDE.md 설치 (기존 파일이 있으면 백업)
if [ -f "$CLAUDE_DIR/CLAUDE.md" ]; then
  echo "[INFO] 기존 ~/.claude/CLAUDE.md 백업 → CLAUDE.md.bak"
  cp "$CLAUDE_DIR/CLAUDE.md" "$CLAUDE_DIR/CLAUDE.md.bak"
fi
cp "$PROJECT_DIR/config/claude/CLAUDE.md" "$CLAUDE_DIR/CLAUDE.md"
echo "[OK] ~/.claude/CLAUDE.md 설치 완료"

# 2. settings.json 병합 (hooks 추가)
if [ -f "$CLAUDE_DIR/settings.json" ]; then
  # UserPromptSubmit 훅이 이미 있는지 확인
  if grep -q "UserPromptSubmit" "$CLAUDE_DIR/settings.json"; then
    echo "[SKIP] UserPromptSubmit 훅이 이미 설정되어 있습니다"
  else
    echo "[WARN] ~/.claude/settings.json에 수동으로 UserPromptSubmit 훅을 추가하세요:"
    echo ""
    cat "$PROJECT_DIR/config/claude/hooks-snippet.json"
    echo ""
  fi
else
  cp "$PROJECT_DIR/config/claude/settings.json" "$CLAUDE_DIR/settings.json"
  echo "[OK] ~/.claude/settings.json 설치 완료"
fi

echo ""
echo "✅ Claude Code 설정 완료! 새 세션에서 적용됩니다."
