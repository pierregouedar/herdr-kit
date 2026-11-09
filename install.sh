#!/usr/bin/env bash
# Installs the Herdr Desktop kit: "dev" layout, mods, themes, scripts, serie config (+ mouse patch).
# Safe to re-run: every file it replaces is backed up first.
#   ./install.sh               full install
#   ./install.sh --no-serie    skip building serie (keeps the Homebrew one, no mouse support)
set -euo pipefail
cd "$(dirname "$0")"
KIT=$PWD
H="$HOME/.config/herdr-app"
BIN="$HOME/.local/bin"
BACKUP="$H/backup-$(date +%Y%m%d-%H%M%S)"
BUILD_SERIE=1
for a in "$@"; do case "$a" in --no-serie) BUILD_SERIE=0 ;; *) echo "unknown option: $a" >&2; exit 2 ;; esac; done

say() { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

# Back up, then replace (file or directory)
put() {
  local src=$1 dst=$2
  if [ -e "$dst" ] && ! diff -rq "$src" "$dst" >/dev/null 2>&1; then
    mkdir -p "$BACKUP/$(dirname "${dst#"$HOME"/}")"
    cp -R "$dst" "$BACKUP/${dst#"$HOME"/}"
  fi
  mkdir -p "$(dirname "$dst")"
  rm -rf "$dst"
  cp -R "$src" "$dst"
}

say "1/6 Requirements"
for c in git python3; do have "$c" || { echo "missing: $c" >&2; exit 1; }; done
have herdr-app || { echo "Herdr Desktop not found (herdr-app command): install it first." >&2; exit 1; }
have hc || warn "hc (herdr-core) not on PATH: git graphs will not start"
have jq || warn "jq missing: the Claude status line (cost, limits) will not work (brew install jq)"
have glab || warn "glab missing: no GitLab MRs, CI or issues (brew install glab && glab auth login)"
have portless || warn "portless missing: the Servers strip will only show Docker"
have docker || warn "docker missing: no containers in the Servers strip"

say "2/6 Herdr: layout, mods, themes"
for m in "$KIT"/herdr-app/mods/*/; do m=${m%/}; put "$m" "$H/mods/$(basename "$m")"; done
put "$KIT/herdr-app/layouts/dev.json" "$H/layouts/dev.json"
for t in "$KIT"/herdr-app/themes/*.json; do put "$t" "$H/themes/$(basename "$t")"; done
put "$KIT/herdr-app/icons/omp.svg" "$H/icons/omp.svg"
# keys.json and programs.json are merged: settings already on this machine are kept
python3 - "$H" "$KIT" "$BACKUP" <<'EOF'
import json, os, shutil, sys
H, KIT, BACKUP = sys.argv[1:]
def merge(name, src, fn):
    dst = os.path.join(H, name)
    cur = {}
    if os.path.exists(dst):
        os.makedirs(BACKUP, exist_ok=True)
        shutil.copy(dst, os.path.join(BACKUP, name))
        cur = json.load(open(dst))
    fn(cur, json.load(open(src)))
    json.dump(cur, open(dst, "w"), indent=2, ensure_ascii=False)
def keys(cur, new):
    cur["layout:dev"] = new["layout:dev"]          # section owned by the kit's layout
def programs(cur, new):
    p = cur.setdefault("programs", {})
    for k, v in new["programs"].items():
        p.setdefault(k, v)                             # never overrides an existing entry
merge("keys.json", os.path.join(KIT, "herdr-app/keys.dev.json"), keys)
merge("programs.json", os.path.join(KIT, "herdr-app/programs.json"), programs)
EOF

say "3/6 Scripts in $BIN"
mkdir -p "$BIN"
for f in "$KIT"/bin/*; do put "$f" "$BIN/$(basename "$f")"; chmod +x "$BIN/$(basename "$f")"; done
case ":$PATH:" in *":$BIN:"*) ;; *) warn "$BIN is not on PATH: add it (before /opt/homebrew/bin) in ~/.zshrc" ;; esac

say "4/6 serie (git graph)"
put "$KIT/serie/config.toml" "$HOME/.config/serie/config.toml"
if [ "$BUILD_SERIE" = 1 ] && have cargo; then
  tmp=$(mktemp -d)
  git clone -q --depth 1 --branch v0.10.1 https://github.com/lusingander/serie.git "$tmp/serie" 2>/dev/null
  (cd "$tmp/serie" && git apply "$KIT/serie/mouse.patch" && cargo build --release -q)
  # rm before cp: macOS kills a binary copied over another one (cached code signature)
  rm -f "$BIN/serie" && cp "$tmp/serie/target/release/serie" "$BIN/serie"
  rm -rf "$tmp"
  echo "serie built with mouse support"
elif have serie; then
  warn "serie without mouse support (no cargo, or --no-serie): click and double-click disabled, d key still works"
elif have brew; then
  brew install serie
  warn "serie installed with Homebrew, without mouse support"
else
  warn "serie not found: install it (brew install serie, or cargo for the mouse build)"
fi

say "5/6 Agents: Claude status line, opencode plugin"
put "$KIT/claude/statusline.sh" "$HOME/.claude/statusline-herdr.sh"
chmod +x "$HOME/.claude/statusline-herdr.sh"
python3 - <<'EOF'
import json, os
p = os.path.expanduser("~/.claude/settings.json")
s = json.load(open(p)) if os.path.exists(p) else {}
if "statusLine" in s:
    print("! Claude already has a status line: to get cost and limits in the bottom bar, replace it with")
    print('  "statusLine": {"type": "command", "command": "bash ~/.claude/statusline-herdr.sh"}')
else:
    s["statusLine"] = {"type": "command", "command": "bash ~/.claude/statusline-herdr.sh"}
    os.makedirs(os.path.dirname(p), exist_ok=True)
    json.dump(s, open(p, "w"), indent=2, ensure_ascii=False)
    print("Claude status line enabled")
EOF
if [ -d "$HOME/.config/opencode" ]; then
  put "$KIT/opencode/hc-osc-status.js" "$HOME/.config/opencode/plugins/hc-osc-status.js"
  echo "opencode plugin installed"
fi

say "6/6 Checks"
fail=0
for m in "$KIT"/herdr-app/mods/*/; do
  herdr-app check "$H/mods/$(basename "$m")" >/dev/null 2>&1 || { warn "check failed: $(basename "$m")"; fail=1; }
done
[ "$fail" = 0 ] && echo "all mods pass herdr-app check"
[ -d "$BACKUP" ] && echo "previous files backed up in $BACKUP"
echo
say "Done. In Herdr: press ctrl-shift-l until the \"dev\" layout shows (or herdr-app do layout.switch '{\"name\":\"dev\"}')."
