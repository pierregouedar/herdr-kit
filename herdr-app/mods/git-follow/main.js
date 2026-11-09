// Invisible controller: the right-hand git column follows the active space.
// Repos = the space's folder if it is a repo, otherwise its repo subfolders (worktrees excluded).
// One `serie` terminal per repo (kept by herdr-core), then the column is rewritten via layout.set.
import { View, div } from "gpui-kit";
import { exec, focused, hc, home, layout, nextCommand, openOverlay, panes, run, setShared, shared, spaces, terminals } from "herdr";

const COLUMN = "hk-git";
const FIND = `
for d in "$@"; do
  # Repo without commits is ignored: serie exits right away there (the card would flicker in a loop)
  top=$(git -C "$d" rev-parse --show-toplevel 2>/dev/null) && { git -C "$top" rev-parse -q --verify HEAD >/dev/null && echo "$top"; continue; }
  for s in "$d"/*/; do [ -d "$s.git" ] && git -C "$s" rev-parse -q --verify HEAD >/dev/null && echo "\${s%/}"; done
done | awk '!seen[$0]++'
`;

const base = (p) => p.split("/").pop();
// Space colors (shared "space.colors": theme color name or #hex), like the picker mod
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36).slice(0, 4);
// Graph fallen back to a shell (serie exited, e.g. after a core restart): not alive; grace period at launch
const fresh = {};
const serieUp = (t) => t.state === "live" && !(t.program?.shell && !(fresh[t.name] && Date.now() - fresh[t.name] < 10000));
const termName = (repo) => `graph-${base(repo).slice(0, 20)}-${hash(repo)}`.toLowerCase().replace(/[^a-z0-9_-]/g, "-");

function findNode(n, id) {
  if (!n || typeof n !== "object") return null;
  if (n.id === id) return n;
  for (const c of n.children ?? []) { const r = findNode(c, id); if (r) return r; }
  return null;
}

export default class GitFollow extends View {
  init(_p, cx) {
    this.folder = null;
    this.busy = false;
    // Herdr's Files and Changes panels removed from the tab bar (the git column replaces them)
    if ((shared("workspace.panels") ?? ["files", "changes"]).length) setShared("workspace.panels", []);
    // Today's cost per Claude session (key: session title), read by the hk-pane headers
    const costs = (cx) => cx.spawn(async () => {
      const r = await exec(`${home()}/.local/bin/hk-agents`, ["--session-costs"]);
      try { setShared("hk.session.costs", JSON.parse(r.stdout)); } catch { /* keep the old one */ }
    });
    cx.timer.every(30000, costs);
    costs(cx);
    // Activity on my MRs (all projects): notification when someone else comments, approves, etc.
    cx.timer.every(120000, (cx) => this.mrActivity(cx));
    this.mrActivity(cx);
    // Accent of the whole window = active space's color
    cx.timer.every(150, () => {
      const sp = spaces().find((s) => s.active);
      const c = sp && (shared("space.colors") ?? {})[sp.id];
      const hex = c ? (c.startsWith("#") ? c : MARK[c]) : null;
      const tree = layout();
      if (!hex || !tree || tree.colors?.accent === hex) return;
      const next = JSON.parse(JSON.stringify(tree));
      next.colors = { ...(next.colors ?? {}), accent: hex };
      run("layout.set", { layout: next });
    });
    // Focus mode (keys.json: cmd-. -> git-follow.focus): sidebar and right column collapsed
    cx.spawn(async () => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") {
          run("layout.toggle", { id: "sidebar" });
          run("layout.toggle", { id: COLUMN });
        } else if (c === "commit-diff") {
          // Set by hk-commit-diff (d key in serie): diff of the selected commit
          const r = await exec("cat", [`${home()}/.cache/hk-commit-diff.json`]);
          try {
            const { repo, commit, subject } = JSON.parse(r.stdout);
            openOverlay({ mod: "hk-diff", kind: "dialog", width: 1300, height: 820,
                          props: { repo, commit, label: `${repo.split("/").pop()} · ${commit.slice(0, 8)}`, subject } });
          } catch { /* file missing or unreadable */ }
        } else if (c === "nav-next" || c === "nav-prev") this.nav(c === "nav-next" ? 1 : -1);
      }
    });
    // Reorders the repos if activity changed (at most one layout rewrite per minute)
    cx.timer.every(60000, () => { this.folder = null; });
    // ponytail: active space checked every second (memory read, no exec if unchanged)
    cx.timer.every(250, (cx) => {
      // Folders = cwd of the active space's panes, excluding home (remote spaces ignored)
      const sp = spaces().find((s) => s.active);
      if (!sp || sp.machine) return;
      const tabs = new Set(sp.tabs.map((t) => t.id));
      const dirs = [...new Set(panes().filter((p) => tabs.has(p.tab) && p.cwd && p.cwd !== home()).map((p) => p.cwd))].sort();
      const key = JSON.stringify(dirs);
      // Shared with hk-subagents, which filters Claude sessions on these folders
      if (JSON.stringify(shared("hk.space.dirs") ?? null) !== key) setShared("hk.space.dirs", dirs);
      // Re-sync also if a displayed graph is dead (serie quit or crashed: Herdr removes its card)
      const live = new Set(terminals().filter(serieUp).map((t) => t.address));
      // Cards actually present in the layout (Herdr may remove one) and live terminals
      const col = findNode(layout(), COLUMN);
      const terms = (col?.children ?? []).filter((c) => c.id?.endsWith("-card")).map((c) => c.children?.[1]?.content?.terminal);
      const shown = terms.length === (this.expected ?? terms.length) && terms.every((a) => live.has(a));
      if (key !== this.folder || !shown) this.sync(cx, dirs, key);
    });
  }

  mrActivity(cx) {
    cx.spawn(async () => {
      const cwd = (shared("hk.space.repos") ?? [])[0] ?? home(); // glab takes the repo's host (otherwise its default host)
      const api = async (path) => {
        const r = await exec("glab", ["api", path], { cwd });
        try { return r.code ? null : JSON.parse(r.stdout); } catch { return null; }
      };
      this.me ??= (await api("user"))?.username;
      const mrs = await api("merge_requests?state=opened&scope=created_by_me&per_page=20");
      if (!this.me || !mrs) return;
      const seen = shared("hk.mr.seen") ?? {}; // last note id seen per MR
      const first = !Object.keys(seen).length; // first pass: remember without notifying
      const toasts = [];
      for (const mr of mrs) {
        const key = `${mr.project_id}!${mr.iid}`;
        const notes = await api(`projects/${mr.project_id}/merge_requests/${mr.iid}/notes?sort=desc&per_page=10`);
        if (!notes?.length) continue;
        const fresh = notes.filter((n) => n.id > (seen[key] ?? 0) && n.author?.username !== this.me);
        seen[key] = Math.max(seen[key] ?? 0, ...notes.map((n) => n.id));
        if (first || !fresh.length) continue;
        const n = fresh[0];
        const who = n.author?.name ?? n.author?.username;
        const what = n.system ? n.body : `a commenté : ${n.body.replace(/\s+/g, " ").slice(0, 90)}`;
        toasts.push({ title: `!${mr.iid} · ${who}`, body: `${what}${fresh.length > 1 ? ` (+${fresh.length - 1})` : ""}`,
                      level: /approved/.test(n.body) ? "success" : /requested changes|unapproved/.test(n.body) ? "warning" : "info",
                      timeout: 30000, actions: [{ label: "Ouvrir la MR", open: `${mr.web_url}#note_${n.id}` }] });
      }
      setShared("hk.mr.seen", seen);
      if (toasts.length) {
        const now = Date.now();
        setShared("hk.toasts", [...(shared("hk.toasts") ?? []),
          ...toasts.map((x, i) => ({ id: `mr${now}${i}`, until: now + x.timeout, ...x }))]);
      }
    });
  }

  // Order: the tab's pane (last focused), then each graph of the column, in a loop
  nav(step) {
    const f = focused();
    if (f?.pane) this.lastPane = f.pane;
    const col = findNode(layout(), COLUMN);
    const graphs = (col?.children ?? []).filter((c) => c.id?.endsWith("-card")).map((c) => c.children?.[1]?.content?.terminal).filter(Boolean);
    const stops = [{ pane: this.lastPane ?? panes().find((p) => p.focused)?.pane }, ...graphs.map((t) => ({ terminal: t }))];
    const at = f?.pane ? 0 : Math.max(0, graphs.indexOf(f?.terminal) + 1);
    const next = stops[(at + step + stops.length) % stops.length];
    if (next.pane || next.terminal) run("pane.focus", next);
  }

  sync(cx, dirs, key) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        // Per-space cache: set the known repos right away, then check on disk
        const cache = shared("hk.cache.repos") ?? {};
        if (cache[key] && key !== this.folder) await this.apply(cache[key], key);
        const r = await exec("sh", ["-c", FIND, "sh", ...dirs]);
        // Most recently touched repo (git index) first; 4 repos max on screen
        const found = r.stdout.split("\n").filter(Boolean);
        const mt = found.length
          ? (await exec("sh", ["-c", 'for d; do stat -f %m "$d/.git/index" 2>/dev/null || echo 0; done', "sh", ...found])).stdout.split("\n").map(Number)
          : [];
        const repos = found.map((d, i) => [d, mt[i] || 0]).sort((a, b) => b[1] - a[1]).map(([d]) => d).slice(0, 4);
        if (JSON.stringify(cache[key]) !== JSON.stringify(repos)) setShared("hk.cache.repos", { ...cache, [key]: repos });
        await this.apply(repos, key);
      } finally {
        this.busy = false;
        cx.notify();
      }
    });
  }

  // Brings the column in line with these repos; only rewrites the layout if something changes
  async apply(repos, key) {
    // Graph dead less than a minute after launch: don't relaunch it right away (otherwise loop)
    // A graph launched less than a minute ago and already dead (e.g. empty repo) is not relaunched right away.
    // Terminal not listed yet: assume it is alive.
    this.spawned ??= {};
    const all = terminals();
    repos = repos.filter((r) => {
      const s = this.spawned[termName(r)];
      if (!s || Date.now() - s.at > 60000) return true;
      const t = all.find((x) => x.address === s.address);
      return !t || serieUp(t);
    });
    if (JSON.stringify(shared("hk.space.repos")) !== JSON.stringify(repos)) setShared("hk.space.repos", repos);
    const tree = JSON.parse(JSON.stringify(layout()));
    const col = findNode(tree, COLUMN);
    if (!col) return;
    const current = (col.children ?? []).filter((c) => c.id?.endsWith("-card")).map((c) => c.children?.[0]?.content?.props?.repo);
    const cardTerms = (col.children ?? []).filter((c) => c.id?.endsWith("-card")).map((c) => c.children?.[1]?.content?.terminal);
    const allLive = cardTerms.every((a) => terminals().some((t) => t.address === a && serieUp(t)));
    this.expected = repos.length;
    if (JSON.stringify(current) === JSON.stringify(repos) && allLive) { this.folder = key; return; }

    for (const t of terminals()) if (t.state === "live" && t.name?.startsWith("graph-") && !serieUp(t)) await hc(["kill", t.address]);
    const live = new Map(terminals().filter((t) => serieUp(t) && t.name).map((t) => [t.name, t.address]));
    const cards = [];
    for (const repo of repos) {
      const name = termName(repo);
      let address = live.get(name);
      if (!address) {
        const s = await hc(["run", "--json", "--bg", "--keep", "--no-parent", "--outlive-parent",
          "--name", name, "--cwd", repo, "--", "serie"]);
        address = JSON.parse(s.stdout).address;
        this.spawned[name] = { at: Date.now(), address };
        fresh[name] = Date.now();
      }
      const id = `git-${hash(repo)}`;
      cards.push({
        id: `${id}-card`, type: "column", size: { weight: cards.length === 0 && repos.length > 1 ? 3 : 2 }, min: 160, radius: 10,
        border: { width: 1, color: "border" }, background: "background", resizable: false,
        children: [
          { id: `${id}-bar`, type: "block", size: { px: 36 },
            content: { mod: "hk-git-bar", props: { repo, label: base(repo), terminal: address } } },
          { id: `${id}-term`, type: "block", content: { terminal: address } },
        ],
      });
    }
    // Everything this mod set starts with "git-" (a card whose terminal dies may be flattened by Herdr)
    const mine = (c) => /^git-[a-z0-9]{1,4}-/.test(c.id ?? "");
    col.children = [...cards, ...(col.children ?? []).filter((c) => !mine(c))];
    run("layout.set", { layout: tree });
    this.folder = key;
    // Freshly created graph: it already starts on HEAD; reused graphs go back to the top (g key)
    for (const c of cards) if ([...live.values()].includes(c.children[1].content.terminal)) await hc(["keys", c.children[1].content.terminal, "g"]);
  }

  render() {
    return div();
  }
}
