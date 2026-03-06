#!/bin/bash
# TaskForce.AI - Claude Code + Codex 설정 스크립트
# 사용법: ./scripts/setup-claude.sh

set -e

CLAUDE_DIR="$HOME/.claude"
CODEX_DIR="$HOME/.codex"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Claude Code 설정 ==="
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
echo "=== Codex 설정 ==="
mkdir -p "$CODEX_DIR"

# 3. AGENTS.md 설치 (프로젝트 루트)
if [ -f "$PROJECT_DIR/AGENTS.md" ]; then
  echo "[SKIP] AGENTS.md가 이미 존재합니다"
else
  cp "$PROJECT_DIR/config/codex/AGENTS.md" "$PROJECT_DIR/AGENTS.md"
  echo "[OK] AGENTS.md 설치 완료 (프로젝트 루트)"
fi

# 4. Codex config.toml에 TaskForce MCP 추가
CODEX_CONFIG="$CODEX_DIR/config.toml"
if [ -f "$CODEX_CONFIG" ]; then
  if grep -q "mcp_servers.taskforce" "$CODEX_CONFIG"; then
    echo "[SKIP] Codex TaskForce MCP가 이미 설정되어 있습니다"
  else
    echo "" >> "$CODEX_CONFIG"
    cat "$PROJECT_DIR/config/codex/mcp-snippet.toml" >> "$CODEX_CONFIG"
    echo "[OK] Codex config.toml에 TaskForce MCP 추가 완료"
  fi
else
  # Python 경로와 mcp_server.py 경로를 자동 설정
  sed "s|__PROJECT_DIR__|$PROJECT_DIR|g" "$PROJECT_DIR/config/codex/config.toml" > "$CODEX_CONFIG"
  echo "[OK] ~/.codex/config.toml 설치 완료"
fi

echo ""
echo "✅ 설정 완료!"
echo "   - Claude Code: 새 세션에서 적용 (Hook은 즉시 적용)"
echo "   - Codex: codex 실행 시 적용"
