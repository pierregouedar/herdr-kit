# herdr-kit

A ready-to-use workspace for [Herdr Desktop](https://herdr.dev): your coding agent in the middle, the git
state of the active space's repos on the right, agents and costs always in view.

## What you get

- **`dev` layout**
  - The active pane in the center, with a header showing the session title, status, branch and cost.
  - The left sidebar lists spaces, each with a second line (agents, servers, branch), and the agents.
  - A bottom bar shows the Claude and Codex usage: today's cost and the 5 h / 7 d limits.
- **Git column on the right**: it follows the active space and finds its repos by itself (up to 4).
  Each repo gets:
  - a one-line header: branch (click to switch), ahead / behind, modified files, commits behind the base
    branch, MR (approvals, threads), CI, last test results, worktrees;
  - action buttons: fetch, pull, push, clean (deletes local branches whose remote is gone);
  - a [serie](https://github.com/lusingander/serie) commit graph. With the mouse patch: click a commit to
    unfold its preview, click it again to fold it, double-click to open its files and diffs.
- **Agents block**: Claude Code, omp, Codex and opencode sessions of the space, with their running
  subagents. A toast shows up when a subagent finishes, with a link to its report.
- **Servers strip**: [portless](https://github.com/vercel-labs/portless) routes and Docker containers of
  the space (start, restart, stop, logs), plus a button to run `dev`.
- **⌘K palette**:
  - spaces, the `scripts/` folder of the space's repos, npm scripts;
  - GitLab MRs, pipelines and assigned issues;
  - new worktree, commit search, daily recap, focus mode.
- **Diff modal, daily recap (⌘⌥R), 7-day cost history**, MR activity toasts, `hk-day` / `hk-night`
  themes.

## Requirements

| Tool | Needed for | Required |
|---|---|---|
| Herdr Desktop (`herdr-app`, `hc`) | everything | yes |
| `git`, `python3` | everything | yes |
| `serie` (or `cargo` to build the mouse version) | git graph | yes |
| `jq` | Claude status line (cost, limits) | recommended |
| `glab`, logged in (`glab auth login`) | MRs, CI, issues, recap | optional |
| `portless`, `docker` | Servers strip | optional |

The kit targets macOS: links open with `open`.

## Install

```sh
git clone <this repo> ~/herdr-kit
cd ~/herdr-kit
./install.sh             # or ./install.sh --no-serie to skip building serie
```

Then in Herdr press `ctrl-shift-l` until the **dev** layout shows.

What the installer does:

- **Herdr files**: copies mods, layout, themes and icons into `~/.config/herdr-app`.
  - `keys.json` and `programs.json` are merged, not replaced.
  - Any file it replaces is first saved in `~/.config/herdr-app/backup-<date>/`.
- **Scripts**: copies them into `~/.local/bin`, which must come before Homebrew in your `PATH`.
- **serie**: builds it with the mouse patch (`serie/mouse.patch`) when `cargo` is available.
  Otherwise it falls back to the Homebrew build.
- **Agents**:
  - installs the Claude status line as `~/.claude/statusline-herdr.sh`;
  - enables it only if you have no status line yet; otherwise it prints the line to paste;
  - installs the opencode status plugin if opencode is installed.

To update: `git pull && ./install.sh`.
To roll back: copy the files back from the backup folder.

### Agent status in Herdr

Herdr only lists agents that report their status:

- **Claude, Codex, omp and others**: install Herdr's integration once per agent, for example
  `herdr integration install claude`.
- **opencode**: the kit ships its own plugin, because Herdr's opencode integration only works in the
  `herdr` terminal app, not in Herdr Desktop.

## Shortcuts (dev layout)

| Keys | Action |
|---|---|
| ⌘K | palette |
| ⌘. | focus mode (hides the sidebar and the git column) |
| ⌘⌥→ / ⌘⌥← | move between the main pane and the git graphs |
| ⌘⌥F / ⌘⌥P / ⌘⌥U / ⌘⌥K | fetch / pull / push / clean, on the first repo |
| ⌘⌥R | daily recap |

In a git graph:

| Keys | Action |
|---|---|
| click | unfold or fold the commit preview |
| double-click or `d` | open the commit's files and diffs |
| `o` | open the commit in GitLab / GitHub |
| `shift+r` | refresh |

## How it adapts to each machine

- **Repos**: the git column scans the folders the space's panes are in.
  - It takes the repo itself, or the git repos one level below.
  - It skips worktrees and repos without commits.
  - The most recently touched repo comes first.
- **Base branch**: `develop` if `origin/develop` exists, otherwise the remote's default branch.
- **Package manager**: picked from the lockfile (pnpm, yarn, bun, npm).
- **Paths**: all relative to `$HOME`; nothing is tied to one machine.

## Layout of this repo

```
herdr-app/   layouts/dev.json, mods/, themes/, icons/, keys.dev.json, programs.json
bin/         helper scripts used by the mods (agents and costs, servers, tests, git links, commit diff)
serie/       serie config and the mouse patch (against serie v0.10.1)
claude/      Claude Code status line (writes the cost and limits the bottom bar reads)
opencode/    opencode plugin reporting its status to Herdr Desktop
install.sh
```

## Troubleshooting

- **A git graph shows a shell prompt**: serie exited, for example after a Herdr update. The column
  restarts it on its own within a few seconds.
- **serie is killed as soon as it starts after copying it by hand**: remove the old binary before
  copying the new one (`rm` then `cp`). macOS caches the code signature per file.
- **A mod misbehaves**: run `herdr-app check ~/.config/herdr-app/mods/<name>` and
  `herdr-app status` to see the error.

## License

Apache License 2.0, see [LICENSE](LICENSE). Parts derived from Herdr and serie are listed in [NOTICE](NOTICE).
