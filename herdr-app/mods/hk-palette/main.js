// Palette ⌘K: filterable project actions (spaces, scripts, MRs, worktree, e2e, servers, focus mode).
// Up/down to choose, Enter to run, Esc to close.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { closeOverlay, exec, home, openOverlay, panes, props, readTextFile, run, shared, spaces, theme } from "herdr";

// Runs an npm script with the repo's package manager (lockfile), pnpm/yarn/bun/npm
const pmArgv = (script) => ["sh", "-c",
  'if [ -f pnpm-lock.yaml ]; then exec pnpm "$0"; elif [ -f yarn.lock ]; then exec yarn "$0"; ' +
  'elif [ -f bun.lockb ] || [ -f bun.lock ]; then exec bun run "$0"; else exec npm run "$0"; fi', script];
const short = (p) => p.split("/").pop();

export default class HkPalette extends View {
  init(_p, cx) {
    this.filter = "";
    this.at = 0;
    this.extra = [];
    this.input = InputState.new({ placeholder: "Action, script, space, serveur, commit…" });
    this.commits = [];
    this.input.on("change", (_e, cx) => {
      this.filter = this.input.value();
      this.at = 0;
      // Commit search after 300 ms without typing, from 3 characters
      const q = this.filter.trim();
      if (q.length < 3) this.commits = [];
      else cx.timer.after(300, (cx) => { if (this.filter.trim() === q) this.searchCommits(cx, q); });
      cx.notify();
    });
    this.input.on("submit", () => this.go(this.rows()[this.at]));
    this.input.focus();
    cx.timer.after(300, () => this.input.focus());
    cx.spawn(async (cx) => this.load(cx));
  }

  // Actions that need disk reads: scripts/ of the space's repos, npm scripts
  async load(cx) {
    const out = [];
    for (const repo of shared("hk.space.repos") ?? []) {
      const ls = await exec("sh", ["-c", `ls "${repo}/scripts" 2>/dev/null`]);
      for (const f of ls.stdout.split("\n").filter((x) => /\.(sh|py)$/.test(x))) {
        const argv = f.endsWith(".py") ? ["python3", f] : ["bash", f];
        out.push({ group: "Script", label: f.replace(/\.(sh|py)$/, ""), hint: `${short(repo)}/scripts`,
                   run: () => run("terminal.open", { argv, folder: `${repo}/scripts`, place: "tab", name: f }) });
      }
    }
    for (const repo of shared("hk.space.repos") ?? []) {
      let pkg = null;
      try { pkg = JSON.parse(await readTextFile(`${repo}/package.json`)); } catch { /* no Node */ }
      for (const s of ["test:e2e", "test", "typecheck", "lint", "dev"]) {
        if (pkg?.scripts?.[s]) out.push({ group: "npm", label: `${s}`, hint: short(repo),
          run: () => run("terminal.open", { argv: pmArgv(s), folder: repo, place: "tab", name: s }) });
      }
    }
    // GitLab issues assigned to me (all projects): Enter opens the issue
    const glCwd = (shared("hk.space.repos") ?? [])[0] ?? home();
    const iss = await exec("glab", ["api", "issues?state=opened&scope=assigned_to_me&per_page=30&order_by=updated_at"], { cwd: glCwd });
    try {
      for (const i of JSON.parse(iss.stdout)) {
        out.push({ group: "Issue", label: i.title, hint: (i.references?.full ?? `#${i.iid}`).split("/").pop(), run: () => exec("open", [i.web_url]) });
      }
    } catch { /* glab unavailable: no issues */ }
    this.extra = out;
    cx.notify();
  }

  all() {
    const sp = spaces().find((s) => s.active);
    const repos = shared("hk.space.repos") ?? [];
    const cwd = panes().find((p) => p.focused)?.cwd ?? repos[0];
    const items = [];
    for (const s of spaces()) if (!s.active) items.push({ group: "Space", label: s.name, hint: s.branch ?? "", run: () => run("space.select", { id: s.id }) });
    for (const repo of repos) {
      items.push({ group: "GitLab", label: `MR de la branche · ${short(repo)}`, hint: "glab mr view --web",
                   run: () => exec("glab", ["mr", "view", "--web"], { cwd: repo }) });
      items.push({ group: "GitLab", label: `Pipelines · ${short(repo)}`, hint: "glab ci view --web",
                   run: () => exec("glab", ["ci", "view", "--web"], { cwd: repo }) });
      items.push({ group: "Git", label: `Nouveau worktree · ${short(repo)}`, hint: "",
                   run: () => openOverlay({ mod: "worktree", kind: "dialog", width: 460, height: 280, props: { space: sp?.id, folder: repo, action: "new" } }) });
    }
    for (const r of shared("hk.servers") ?? []) items.push({ group: "Ouvrir", label: r.url.replace(/^https?:\/\//, ""), hint: r.up ? "up" : "down", run: () => exec("open", [r.url]) });
    items.push(...this.extra);
    items.push({ group: "Vue", label: "Récap du jour", hint: "⌘⌥R", run: () => run("mod.open", { name: "hk-recap" }) });
    items.push({ group: "Vue", label: "Mode focus", hint: "⌘.", run: () => run("git-follow.focus") });
    items.push({ group: "Vue", label: "Nouveau terminal ici", hint: short(cwd ?? "~"), run: () => run("terminal.open", { folder: cwd, place: "tab" }) });
    items.push({ group: "Herdr", label: "Toutes les commandes Herdr", hint: "⌘⇧P", run: () => run("app.palette") });
    return items;
  }

  // Commit messages (all branches) of the space's repos; Enter opens the commit in GitLab
  searchCommits(cx, q) {
    cx.spawn(async (cx) => {
      const found = [];
      for (const repo of shared("hk.space.repos") ?? []) {
        const r = await exec("git", ["log", "--all", "-i", "--fixed-strings", `--grep=${q}`, "-n", "8", "--format=%h|%ad|%s", "--date=format:%d/%m"], { cwd: repo });
        for (const l of r.stdout.split("\n").filter(Boolean)) {
          const [hash, at, ...subj] = l.split("|");
          found.push({ group: "Commit", label: subj.join("|"), hint: `${short(repo)} · ${at} · ${hash}`,
                       run: () => exec(`${home()}/.local/bin/hk-git-open`, [hash], { cwd: repo }) });
        }
      }
      if (this.filter.trim() === q) { this.commits = found; cx.notify(); }
    });
  }

  rows() {
    const f = this.filter.toLowerCase().split(/\s+/).filter(Boolean);
    const actions = this.all().filter((it) => f.every((w) => `${it.group} ${it.label} ${it.hint}`.toLowerCase().includes(w)));
    return [...actions, ...this.commits].slice(0, 50);
  }

  go(it) {
    if (!it) return;
    closeOverlay(props().overlay);
    it.run();
  }

  render() {
    const t = theme();
    const rows = this.rows();
    if (this.at >= rows.length) this.at = Math.max(0, rows.length - 1);
    return v_flex().id("palette").w_full().p(14).gap(10).bg(t.popover)
      .on_key_down((e, cx) => {
        if (e.key === "escape") return closeOverlay(props().overlay);
        if (e.key === "down") this.at = Math.min(rows.length - 1, this.at + 1);
        else if (e.key === "up") this.at = Math.max(0, this.at - 1);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().h(38).flex_none().px(12).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(div().text_color(t.accent).child("⌘K"))
        .child(Input.new(this.input).flex_1().h_full().text_size(13).text_color(t.foreground)))
      .child(v_flex().id("list").h(Math.max(40, Math.min(460, rows.length * 33))).flex_none().overflow_y_scrollbar().gap(1)
        .children(rows.map((it, i) => h_flex().id(`r${i}`).h(32).px(10).gap(10).items_center().rounded(6)
          .bg(i === this.at ? t.selected : t.popover).hover((s) => s.bg(t.hover))
          .on_click(() => this.go(it))
          .child(div().w(64).flex_none().text_size(10.5).text_color(i === this.at ? t.accent : t.dim).child(it.group.toUpperCase()))
          .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(t.foreground).child(it.label))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(it.hint))))
        .when(!rows.length, (e) => e.child(div().p(12).text_size(12).text_color(t.dim).child("Rien ne correspond"))));
  }
}
