#!/bin/bash
# Marblo - Claude Code + Codex 설정 스크립트
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

# 2. Hook 스크립트 설치 + settings.json 설정
echo ""
echo "=== Hook 설치 ==="
# Hook 스크립트를 ~/.claude/에 복사 (절대경로 안정성)
cp "$PROJECT_DIR/scripts/taskforce-hook.sh" "$CLAUDE_DIR/taskforce-hook.sh"
chmod +x "$CLAUDE_DIR/taskforce-hook.sh"
echo "[OK] ~/.claude/taskforce-hook.sh 설치 완료"

if [ -f "$CLAUDE_DIR/settings.json" ]; then
  if grep -q "taskforce-hook.sh" "$CLAUDE_DIR/settings.json"; then
    echo "[SKIP] Marblo Hook이 이미 설정되어 있습니다"
  elif grep -q "UserPromptSubmit" "$CLAUDE_DIR/settings.json"; then
    echo "[WARN] 기존 UserPromptSubmit 훅이 있습니다. 수동으로 업데이트하세요:"
    echo "  command: \"bash $CLAUDE_DIR/taskforce-hook.sh\""
  else
    echo "[WARN] ~/.claude/settings.json에 수동으로 Hook을 추가하세요:"
    echo ""
    cat "$PROJECT_DIR/config/claude/hooks-snippet.json"
    echo ""
  fi
else
  # 새 settings.json 생성 — 절대경로로 hook 스크립트 참조
  cat > "$CLAUDE_DIR/settings.json" <<SETTINGS_EOF
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash $CLAUDE_DIR/taskforce-hook.sh"
          }
        ]
      }
    ]
  }
}
SETTINGS_EOF
  echo "[OK] ~/.claude/settings.json 설치 완료 (Hook 포함)"
fi

# 3. Marblo 스킬 설치 (글로벌 — 모든 프로젝트에서 /tf-* 사용 가능)
echo ""
echo "=== Marblo 스킬 설치 ==="
SKILLS_SRC="$PROJECT_DIR/config/claude/skills"
if [ -d "$SKILLS_SRC" ]; then
  INSTALLED=0
  for skill_dir in "$SKILLS_SRC"/tf-*/; do
    [ -d "$skill_dir" ] || continue
    skill_name="$(basename "$skill_dir")"
    mkdir -p "$CLAUDE_DIR/skills/$skill_name"
    cp "$skill_dir"SKILL.md "$CLAUDE_DIR/skills/$skill_name/SKILL.md"
    INSTALLED=$((INSTALLED + 1))
  done
  echo "[OK] Marblo 스킬 ${INSTALLED}개 설치 → ~/.claude/skills/"
  echo "     어디서든 /tf-start, /tf-status 등 바로 사용 가능"
else
  echo "[WARN] config/claude/skills/ 디렉토리가 없습니다"
fi

echo ""
echo "=== Codex 설정 ==="
mkdir -p "$CODEX_DIR"

# 4. AGENTS.md 설치 (프로젝트 루트)
if [ -f "$PROJECT_DIR/AGENTS.md" ]; then
  echo "[SKIP] AGENTS.md가 이미 존재합니다"
else
  cp "$PROJECT_DIR/config/codex/AGENTS.md" "$PROJECT_DIR/AGENTS.md"
  echo "[OK] AGENTS.md 설치 완료 (프로젝트 루트)"
fi

# 5. Codex config.toml에 Marblo MCP 추가
CODEX_CONFIG="$CODEX_DIR/config.toml"
if [ -f "$CODEX_CONFIG" ]; then
  if grep -q "mcp_servers.taskforce" "$CODEX_CONFIG"; then
    echo "[SKIP] Codex Marblo MCP가 이미 설정되어 있습니다"
  else
    echo "" >> "$CODEX_CONFIG"
    cat "$PROJECT_DIR/config/codex/mcp-snippet.toml" >> "$CODEX_CONFIG"
    echo "[OK] Codex config.toml에 Marblo MCP 추가 완료"
  fi
else
  # Python 경로와 mcp_server.py 경로를 자동 설정
  sed "s|__PROJECT_DIR__|$PROJECT_DIR|g" "$PROJECT_DIR/config/codex/config.toml" > "$CODEX_CONFIG"
  echo "[OK] ~/.codex/config.toml 설치 완료"
fi

echo ""
echo "✅ 설정 완료!"
echo "   - Claude Code: 새 세션에서 적용 (Hook은 즉시 적용)"
echo "   - Marblo 스킬: 새 세션에서 / 입력 시 tf-* 표시"
echo "   - Codex: codex 실행 시 적용"
echo ""
echo "📌 사용법: 아무 프로젝트에서 claude 실행 후 / 입력"
echo "   /tf-plan    — PRD 작성 + 태스크 분해 계획"
echo "   /tf-start   — 프로젝트 시작 (태스크 생성 + 에이전트 스폰)"
echo "   /tf-status  — 진행 상태 확인"
echo "   /tf-work    — 태스크 claim + 코딩"
echo "   /tf-review  — PM 리뷰 승인/반려"
echo "   /tf-guide   — 전체 명령어 가이드"
