#!/usr/bin/env bash
# Marblo tf 스킬을 CLI 네이티브 스킬로 설치한다 (claude + codex).
#
# 왜 필요한가 (INTELLIGENT-ROUTING-PLAN §D 실측):
#   - claude: `~/.claude/skills` 에 tf-* 가 이미 설치돼 있다(setup-claude.sh).
#             이 스크립트는 그 설치를 멱등·백업·검증 가능한 형태로 승격한다.
#   - codex : `$CODEX_HOME/skills` 는 **사용자 스킬 0개**였다(`.system` 6개뿐).
#             codex 에이전트에 스킬을 지정하면 조용히 무효가 되던 원인.
#             codex 0.145 는 `$CODEX_HOME/skills/<name>/SKILL.md` 를 네이티브로
#             읽는다(근거: ~/.codex/skills/.system/skill-installer/SKILL.md —
#             "Installs into $CODEX_HOME/skills/<skill-name>").
#
# ★안전 원칙 — 이 스크립트는 사용자 홈을 만진다.
#   - 기본이 DRY-RUN 이다. 실제 쓰기는 `--apply` 를 줘야 한다.
#   - 내용이 같으면 건드리지 않는다(멱등).
#   - 내용이 다르면 덮기 전에 `SKILL.md.bak-<타임스탬프>` 로 백업한다.
#   - 우리가 설치하는 이름(tf-*) 밖의 것은 절대 삭제/수정하지 않는다.
#
# 사용법:
#   bash scripts/install-agent-skills.sh                  # dry-run (기본, 안전)
#   bash scripts/install-agent-skills.sh --apply          # 실제 설치 (claude+codex)
#   bash scripts/install-agent-skills.sh --vendor codex --apply
#   bash scripts/install-agent-skills.sh --dest-codex /tmp/probe/.codex --apply
#   bash scripts/install-agent-skills.sh --list           # 설치 대상/현황만 출력
#
# 종료코드: 0=성공, 1=인자/환경 오류, 2=일부 스킬 설치 실패

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SRC_DIR="$PROJECT_DIR/config/claude/skills"

VENDORS="claude codex"
APPLY=0
LIST_ONLY=0
DEST_CLAUDE="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
DEST_CODEX="${CODEX_HOME:-$HOME/.codex}"
FILTER=()

usage() {
  sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --dry-run) APPLY=0 ;;
    --list) LIST_ONLY=1 ;;
    --vendor)
      shift
      case "${1:-}" in
        claude) VENDORS="claude" ;;
        codex) VENDORS="codex" ;;
        both|all) VENDORS="claude codex" ;;
        *) echo "[ERR] --vendor 는 claude|codex|both 중 하나여야 한다 (받은 값: ${1:-없음})" >&2; exit 1 ;;
      esac
      ;;
    --dest-claude) shift; DEST_CLAUDE="${1:?--dest-claude 경로 필요}" ;;
    --dest-codex) shift; DEST_CODEX="${1:?--dest-codex 경로 필요}" ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "[ERR] 알 수 없는 옵션: $1" >&2; exit 1 ;;
    *) FILTER+=("$1") ;;
  esac
  shift
done

if [ ! -d "$SRC_DIR" ]; then
  echo "[ERR] 스킬 소스 디렉토리가 없다: $SRC_DIR" >&2
  exit 1
fi

# 설치 대상 목록 — config/claude/skills/tf-*/SKILL.md
collect_skills() {
  local d name
  for d in "$SRC_DIR"/tf-*/; do
    [ -d "$d" ] || continue
    [ -f "$d/SKILL.md" ] || continue
    name="$(basename "$d")"
    if [ ${#FILTER[@]} -gt 0 ]; then
      local wanted match=0
      for wanted in "${FILTER[@]}"; do
        [ "$wanted" = "$name" ] && match=1
      done
      [ $match -eq 1 ] || continue
    fi
    echo "$name"
  done
}

# ── codex 변환 ───────────────────────────────────────────────────
# tf 스킬 frontmatter 에는 claude 전용 키가 있다(disable-model-invocation,
# allowed-tools, argument-hint). codex 스킬 스키마는 name/description(+metadata)
# 이므로, 의미 없는 키를 그대로 넘기지 않고 걷어낸다. 본문은 손대지 않는다.
CODEX_DROP_KEYS="disable-model-invocation allowed-tools argument-hint model"

render_for_vendor() {
  local vendor="$1" src="$2"
  if [ "$vendor" != "codex" ]; then
    cat "$src"
    return
  fi
  awk -v dropkeys="$CODEX_DROP_KEYS" '
    BEGIN { split(dropkeys, dk, " "); fm=0; dropping=0 }
    NR==1 && $0=="---" { fm=1; print; next }
    fm==1 && $0=="---" { fm=2; dropping=0; print; next }
    fm==1 {
      # 드롭 중인 키의 이어지는 들여쓰기 줄도 함께 버린다
      if (dropping==1 && $0 ~ /^[[:space:]]+/) next
      dropping=0
      if (match($0, /^[A-Za-z0-9_-]+:/)) {
        key=substr($0, 1, RLENGTH-1)
        for (i in dk) if (key==dk[i]) { dropping=1; next }
      }
      print; next
    }
    { print }
  ' "$src"
}

skills_root_for() {
  case "$1" in
    claude) echo "$DEST_CLAUDE/skills" ;;
    codex) echo "$DEST_CODEX/skills" ;;
  esac
}

STAMP="$(date +%Y%m%d-%H%M%S)"
FAILED=0

install_vendor() {
  local vendor="$1"
  local root; root="$(skills_root_for "$vendor")"
  local installed=0 updated=0 unchanged=0 skipped=0

  echo ""
  echo "=== ${vendor} → ${root} ==="
  if [ ! -d "$(dirname "$root")" ]; then
    echo "[SKIP] ${vendor} 홈이 없다($(dirname "$root")) — 해당 CLI 미설치로 보고 건너뛴다."
    return 0
  fi

  local name src dst rendered
  while IFS= read -r name; do
    src="$SRC_DIR/$name/SKILL.md"
    dst="$root/$name/SKILL.md"
    rendered="$(render_for_vendor "$vendor" "$src")"

    if [ -f "$dst" ] && [ "$rendered" = "$(cat "$dst")" ]; then
      unchanged=$((unchanged + 1))
      continue
    fi

    if [ $APPLY -eq 0 ]; then
      if [ -f "$dst" ]; then
        echo "[DRY] 갱신 예정 (백업 후 덮어씀): $dst"
      else
        echo "[DRY] 신규 설치 예정: $dst"
      fi
      skipped=$((skipped + 1))
      continue
    fi

    mkdir -p "$root/$name"
    if [ -f "$dst" ]; then
      cp "$dst" "$dst.bak-$STAMP"
      if printf '%s\n' "$rendered" > "$dst"; then
        echo "[UPD] $name (백업: $(basename "$dst").bak-$STAMP)"
        updated=$((updated + 1))
      else
        echo "[ERR] 쓰기 실패: $dst" >&2
        FAILED=1
      fi
    else
      if printf '%s\n' "$rendered" > "$dst"; then
        echo "[NEW] $name"
        installed=$((installed + 1))
      else
        echo "[ERR] 쓰기 실패: $dst" >&2
        FAILED=1
      fi
    fi
  done < <(collect_skills)

  echo "[SUM] ${vendor}: 신규 ${installed} · 갱신 ${updated} · 동일 ${unchanged} · 대기(dry-run) ${skipped}"
}

list_status() {
  local vendor root name dst
  for vendor in $VENDORS; do
    root="$(skills_root_for "$vendor")"
    echo ""
    echo "=== ${vendor} 설치 현황 (${root}) ==="
    while IFS= read -r name; do
      dst="$root/$name/SKILL.md"
      if [ -f "$dst" ]; then echo "  [O] $name"; else echo "  [ ] $name"; fi
    done < <(collect_skills)
  done
}

echo "Marblo 스킬 설치 — 소스: $SRC_DIR"
echo "대상 스킬: $(collect_skills | wc -l | tr -d ' ')개 / 벤더: $VENDORS"

if [ $LIST_ONLY -eq 1 ]; then
  list_status
  exit 0
fi

if [ $APPLY -eq 0 ]; then
  echo "★DRY-RUN (기본). 실제 설치는 --apply 를 붙여라."
fi

for v in $VENDORS; do
  install_vendor "$v"
done

echo ""
if [ $APPLY -eq 0 ]; then
  echo "완료(dry-run). 아무 파일도 쓰지 않았다."
else
  echo "완료. claude 는 새 세션부터, codex 는 다음 턴부터 스킬이 보인다."
fi
exit $([ $FAILED -eq 0 ] && echo 0 || echo 2)
