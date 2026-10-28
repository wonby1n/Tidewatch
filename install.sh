#!/usr/bin/env sh
# Tidewatch installer (macOS / Linux / Git Bash)
#   curl -fsSL https://raw.githubusercontent.com/wonby1n/tidewatch/main/install.sh | sh
set -eu

RAW="https://raw.githubusercontent.com/wonby1n/tidewatch/main"
HERE="$(cd "$(dirname "$0")" 2>/dev/null && pwd || pwd)"
SRC="$HERE/skills/tidewatch"
TMP=""

if ! command -v node >/dev/null 2>&1; then
  echo "Tidewatch는 Node.js가 필요해요. https://nodejs.org 에서 설치한 뒤 다시 실행해 주세요." >&2
  exit 1
fi

if [ ! -f "$SRC/SKILL.md" ]; then
  TMP="$(mktemp -d)"
  SRC="$TMP/tidewatch"
  mkdir -p "$SRC/scripts" "$SRC/assets"
  curl -fsSL "$RAW/skills/tidewatch/SKILL.md" -o "$SRC/SKILL.md"
  curl -fsSL "$RAW/skills/tidewatch/scripts/tidewatch.mjs" -o "$SRC/scripts/tidewatch.mjs"
  curl -fsSL "$RAW/skills/tidewatch/scripts/usage.mjs" -o "$SRC/scripts/usage.mjs"
  curl -fsSL "$RAW/skills/tidewatch/assets/tidewatch.png" -o "$SRC/assets/tidewatch.png"
  curl -fsSL "$RAW/skills/tidewatch/assets/tidewatch.ico" -o "$SRC/assets/tidewatch.ico"
fi

install_to() {
  mkdir -p "$1"
  rm -rf "$1/tidewatch"
  cp -R "$SRC" "$1/tidewatch"
  echo "  ✓ $1/tidewatch"
}

echo "Tidewatch 스킬 설치"
install_to "$HOME/.claude/skills"          # Claude Code
install_to "$HOME/.agents/skills"          # Codex
[ -d "$HOME/.codex" ] && install_to "$HOME/.codex/skills"   # 예전 Codex 버전

mkdir -p "$HOME/.tidewatch"
cp "$SRC/scripts/tidewatch.mjs" "$HOME/.tidewatch/tidewatch.mjs"
cp "$SRC/scripts/usage.mjs" "$HOME/.tidewatch/usage.mjs"
cp "$SRC/assets/tidewatch.png" "$HOME/.tidewatch/tidewatch.png"
rm -rf "$HOME/.tidewatch/skill" && cp -R "$SRC" "$HOME/.tidewatch/skill"
if [ -f "$HOME/.tidewatch/server.pid" ]; then kill "$(cat "$HOME/.tidewatch/server.pid")" 2>/dev/null || true; rm -f "$HOME/.tidewatch/server.pid"; fi
PAGE="$(node "$HOME/.tidewatch/tidewatch.mjs" build)"
if [ -n "$TMP" ]; then rm -rf "$TMP"; fi

# 바탕화면 바로가기: 누르면 주소창 없는 앱 창으로 열린다
NODE_BIN="$(command -v node)"
case "$(uname -s)" in
  Darwin)
    LAUNCHER="$HOME/Desktop/Tidewatch.command"
    printf '#!/bin/sh\n"%s" "$HOME/.tidewatch/tidewatch.mjs" app >/dev/null\nexit 0\n' "$NODE_BIN" > "$LAUNCHER"
    chmod +x "$LAUNCHER"
    echo "  ✓ 바탕화면 바로가기: $LAUNCHER"
    ;;
  Linux)
    DESK="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
    if [ -d "$DESK" ]; then
      LAUNCHER="$DESK/tidewatch.desktop"
      printf '[Desktop Entry]\nType=Application\nName=Tidewatch\nComment=AI 세션 현황판\nExec="%s" "%s/.tidewatch/tidewatch.mjs" app\nIcon=%s/.tidewatch/tidewatch.png\nTerminal=false\n' "$NODE_BIN" "$HOME" "$HOME" > "$LAUNCHER"
      chmod +x "$LAUNCHER"
      echo "  ✓ 바탕화면 바로가기: $LAUNCHER"
    fi
    ;;
esac

echo ""
echo "끝! 바탕화면의 Tidewatch를 눌러 현황판을 열어 두세요. (직접 열기: node ~/.tidewatch/tidewatch.mjs app)"
echo "Claude Code나 Codex에서 \"타이드워치 켜줘\"라고 하면 카드가 생겨요."
