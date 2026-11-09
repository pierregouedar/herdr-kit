#!/bin/bash
# Claude Code Status Line - one line, segments / powerline style
# Model ❯ Folder ❯ Git ❯ Duration ❯ Cost ❯ Diff ❯ Context ❯ Session quota ❯ Weekly quota
#
# Settings:
#   CC_SL_SEP   segment separator (default "❯", Nerd Font: "")
#   CC_SL_BAR   2 characters "full empty" (default "▰▱", alternatives "█░" "●○")
#   CC_SL_RST   reset glyph (default "⟳", alternatives "↻" "⭮" "🔄" "~")
#   CC_SL_HIDE  segments to hide, comma-separated
#               among: effort,dur,diff,ctx,quota  (e.g. CC_SL_HIDE=dur,diff)
export LC_NUMERIC=C
SEP_GLYPH=${CC_SL_SEP:-❯}
BAR_GLYPHS=${CC_SL_BAR:-▰▱}
RESET_GLYPH=${CC_SL_RST:-⟳}
BAR_ON=${BAR_GLYPHS:0:1}; BAR_OFF=${BAR_GLYPHS:1:1}
hidden() { case ",${CC_SL_HIDE}," in *",$1,"*) return 0;; *) return 1;; esac; }
input=$(cat)

# ── Extract: a single jq call, fields separated by \x1f (keeps empty ones) ──
IFS=$'\x1f' read -r -d '' MODEL_NAME DIR PCT CTX_SIZE USED COST DURATION_MS ADDED REMOVED \
                         EFFORT FAST RL5 RL5_RESET RL7 < <(
  printf '%s' "$input" | jq -j '
    [ (.model.display_name // "Claude" | sub(" \\(1M context\\)"; " 1M"))
    , (.workspace.current_dir // .cwd // "")
    , ((.context_window.used_percentage // 0) | floor)
    , (.context_window.context_window_size // 200000)
    , ((.context_window.current_usage.input_tokens // 0)
       + (.context_window.current_usage.cache_creation_input_tokens // 0)
       + (.context_window.current_usage.cache_read_input_tokens // 0))
    , (.cost.total_cost_usd // 0)
    , (.cost.total_duration_ms // 0)
    , (.cost.total_lines_added // 0)
    , (.cost.total_lines_removed // 0)
    , (.effort.level // "")
    , (.fast_mode // false)
    , (.rate_limits.five_hour.used_percentage // -1)
    , (.rate_limits.five_hour.resets_at // 0)
    , (.rate_limits.seven_day.used_percentage // -1)
    ] | map(tostring) | join("")' ; printf '\0'
)

# ponytail: guard if the JSON is missing/invalid
: "${MODEL_NAME:=Claude}"; : "${PCT:=0}"; : "${CTX_SIZE:=200000}"; : "${USED:=0}"
: "${COST:=0}"; : "${DURATION_MS:=0}"; : "${ADDED:=0}"; : "${REMOVED:=0}"
: "${RL5:=-1}"; : "${RL7:=-1}"; : "${RL5_RESET:=0}"

# Cost per session and per day, read by Herdr's Subagents panel (hk-agents --cost)
SID=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)
if [ -n "$SID" ]; then
  _cd="$HOME/.claude/cost/$(date +%Y-%m-%d)"; mkdir -p "$_cd" && printf '%s' "$COST" > "$_cd/$SID"
  # Usage limits (5 h, 7 d): last known values, shared by all sessions
  [ "$RL5" != "-1" ] && printf '{"rl5":%s,"rl5_reset":%s,"rl7":%s}' "$RL5" "$RL5_RESET" "$RL7" > "$HOME/.claude/cost/limits.json"
fi

# ── 256-color palette, desaturated ──────────────────────────────────────────
c()  { printf '\033[38;5;%sm' "$1"; }
RST='\033[0m'; BOLD='\033[1m'
DIM=$(c 240)        # separators
MUTED=$(c 245)      # secondary text
LABEL=$(c 243)      # labels (5h, 7d)
IRIS=$(c 111)       # model
SKY=$(c 116)        # folder
MAUVE=$(c 176)      # clean git
SAGE=$(c 108)       # duration
LEAF=$(c 114)       # ok / additions
AMBER=$(c 179)      # warning
CORAL=$(c 174)      # alert / deletions
TRACK=$(c 238)      # bar background

# hue <value> [amber_threshold] [coral_threshold]
hue() { if   [ "$1" -ge "${3:-90}" ]; then printf '%s' "$CORAL"
        elif [ "$1" -ge "${2:-70}" ]; then printf '%s' "$AMBER"
        else printf '%s' "$LEAF"; fi; }

SEP=" ${DIM}${SEP_GLYPH}${RST} "

# ── Model ───────────────────────────────────────────────────────────────────
MODEL_STR="${IRIS}${BOLD}${MODEL_NAME}${RST}"
[ -n "$EFFORT" ] && [ "$EFFORT" != "medium" ] && ! hidden effort \
    && MODEL_STR="${MODEL_STR}${DIM}·${EFFORT}${RST}"
[ "$FAST" = "true" ] && MODEL_STR="${MODEL_STR}${AMBER}+${RST}"

# ── Directory ───────────────────────────────────────────────────────────────
DIR_NAME="${DIR##*/}"; [ -z "$DIR_NAME" ] && DIR_NAME="~"

# ── Git: a single call (branch + ahead/behind + dirty) ─────────────────────
GIT_STR=""
if GS=$(git -C "$DIR" status -sb --porcelain -uno --ignore-submodules=dirty 2>/dev/null); then
    HEADLINE=${GS%%$'\n'*}
    BRANCH=${HEADLINE#\#\# }; BRANCH=${BRANCH%%...*}; BRANCH=${BRANCH%% *}
    [ "$BRANCH" = "No" ] && BRANCH="detached"
    TRACKING=""
    case "$HEADLINE" in *"ahead "*)  A=${HEADLINE##*ahead };  TRACKING="${TRACKING} ${MUTED}${A%%[],]*}↑";; esac
    case "$HEADLINE" in *"behind "*) B=${HEADLINE##*behind }; TRACKING="${TRACKING} ${MUTED}${B%%[],]*}↓";; esac
    if [ "$GS" != "$HEADLINE" ]; then GIT_STR="${AMBER}${BRANCH}*${RST}"
    else                              GIT_STR="${MAUVE}${BRANCH}${RST}"; fi
    GIT_STR="${GIT_STR}${TRACKING}${RST}"
fi

# ── Duration ────────────────────────────────────────────────────────────────────
SEC=$((DURATION_MS / 1000)); H=$((SEC/3600)); M=$(((SEC%3600)/60)); S=$((SEC%60))
if   [ "$H" -gt 0 ]; then DUR_STR=$(printf "%dh%02d" "$H" "$M")
elif [ "$M" -gt 0 ]; then DUR_STR="${M}m"
else                      DUR_STR="${S}s"; fi

# ── Cost ─────────────────────────────────────────────────────────────────────
COST_FMT=$(printf '$%.2f' "$COST")
COST_INT=$(awk -v c="$COST" 'BEGIN{printf "%d", c*100}')
if   [ "$COST_INT" -ge 500 ]; then COST_COLOR="$CORAL"
elif [ "$COST_INT" -ge 100 ]; then COST_COLOR="$AMBER"
else                               COST_COLOR="$SAGE"; fi

# ── Session diff ──────────────────────────────────────────────────────────
DIFF_STR=""
if [ "$ADDED" -gt 0 ] || [ "$REMOVED" -gt 0 ]; then
    DIFF_STR="${LEAF}+${ADDED}${RST} ${CORAL}-${REMOVED}${RST}"
fi

# ── Context bar ────────────────────────────────────────────────────────
BAR_WIDTH=8
FILLED=$((PCT * BAR_WIDTH / 100))
[ "$PCT" -gt 0 ] && [ "$FILLED" -eq 0 ] && FILLED=1   # 1% must not show an empty bar
EMPTY=$((BAR_WIDTH - FILLED))
CTX_COLOR=$(hue "$PCT")
BAR="${CTX_COLOR}"
[ "$FILLED" -gt 0 ] && BAR="${BAR}$(printf "%${FILLED}s" | tr ' ' "$BAR_ON")"
BAR="${BAR}${TRACK}"
[ "$EMPTY"  -gt 0 ] && BAR="${BAR}$(printf "%${EMPTY}s" | tr ' ' "$BAR_OFF")"
BAR="${BAR}${RST}"

# ponytail: k/M formatting in awk, no bc
fmt() { awk -v n="$1" 'BEGIN{ if(n>=1000000) printf "%.1fM", n/1000000;
        else if(n>=1000) printf "%.0fk", n/1000; else printf "%d", n }'; }
[ "$USED" -eq 0 ] && [ "$PCT" -gt 0 ] && USED=$((CTX_SIZE * PCT / 100))
USED_FMT=$(fmt "$USED"); CTX_FMT=$(fmt "$CTX_SIZE")

# ── Plan quotas: session (rolling 5h) + weekly (7d) ───────────────────
QUOTA_STR=""
if [ "$RL5" -ge 0 ]; then
    QUOTA_STR="${LABEL}Session${RST} $(hue "$RL5")${RL5}%${RST}"
    if [ "$RL5_RESET" -gt 0 ]; then
        LEFT=$(( RL5_RESET - $(date +%s) ))
        if [ "$LEFT" -gt 0 ]; then
            if [ "$LEFT" -ge 3600 ]; then RESET_FMT=$(printf '%dh%02d' $((LEFT/3600)) $(((LEFT%3600)/60)))
            else                          RESET_FMT="$((LEFT/60))min"; fi
            QUOTA_STR="${QUOTA_STR} ${DIM}(${RESET_GLYPH}${RESET_FMT})${RST}"
        fi
    fi
fi
if [ "$RL7" -ge 0 ]; then
    [ -n "$QUOTA_STR" ] && QUOTA_STR="${QUOTA_STR}${SEP}"
    QUOTA_STR="${QUOTA_STR}${LABEL}Hebdo${RST} $(hue "$RL7")${RL7}%${RST}"
fi

# ── Output: a single line ────────────────────────────────────────────────
LINE="${MODEL_STR}${SEP}${SKY}${DIR_NAME}${RST}"
[ -n "$GIT_STR" ]   && LINE="${LINE}${SEP}${GIT_STR}"
hidden dur || LINE="${LINE}${SEP}${SAGE}${DUR_STR}${RST}"
LINE="${LINE}${SEP}${COST_COLOR}${COST_FMT}${RST}"
[ -n "$DIFF_STR" ]  && ! hidden diff  && LINE="${LINE}${SEP}${DIFF_STR}"
hidden ctx || LINE="${LINE}${SEP}${BAR} ${CTX_COLOR}${PCT}%${RST}"
[ -n "$QUOTA_STR" ] && ! hidden quota && LINE="${LINE}${SEP}${QUOTA_STR}"

printf '%b\n' "$LINE"
