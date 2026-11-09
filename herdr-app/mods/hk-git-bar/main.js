// Header of a git graph: repo, branch, state, quick actions.
// props: { repo, label, base, terminal }  (terminal = the serie to refresh)
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, focused, home, hc, nextCommand, openOverlay, props as rawProps, setShared, shared, theme, watchFolder } from "herdr";
// Kit notification (hk-toasts mod): per-type edge and action buttons
const toast = (n) => setShared("hk.toasts", [...(shared("hk.toasts") ?? []),
  { id: `${Date.now()}${Math.random().toString(36).slice(2, 6)}`, until: Date.now() + (n.timeout ?? 8000), ...n }]);


const props = () => rawProps() ?? {};

const git = (repo, args) => exec("git", args, { cwd: repo });
// git@host:groupe/projet.git -> https://host/groupe/projet
const webUrl = (u) => {
  let x = u.replace(/\.git$/, "");
  if (x.startsWith("git@")) x = `https://${x.slice(4).replace(":", "/")}`;
  else if (x.startsWith("ssh://")) x = `https://${x.replace(/^ssh:\/\/([^@]+@)?/, "").replace(/:\d+\//, "/")}`;
  return x;
};
const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`; // shell escaping

export default class HkGitBar extends View {
  init(_p, cx) {
    // Last known state of this repo (shared cache): the header shows full right away
    const cached = (shared("hk.cache.git") ?? {})[props().repo];
    this.s = cached?.s ?? {};
    this.gl = cached?.gl ?? {};
    this.base = cached?.base;
    this.loading = !cached;
    this.busy = null;
    // Refreshed only when the repo changes (watchFolder), at most every 3 s
    this.dirty = true;
    const { repo } = props();
    if (repo) cx.spawn(async () => {
      // A watchFolder error must not stop the watching: retry on the next loop
      for (;;) { try { await watchFolder(repo); } catch { break; /* repo moved: the 30 s safety net takes over */ } this.dirty = true; }
    });
    // Safety net: re-read every 30 s even without a file event
    cx.timer.every(30000, () => { this.dirty = true; });
    // Silent fetch every 5 min: without it, "behind" (↓) and remote branches never move
    if (repo) cx.timer.every(300000, (cx) => cx.spawn(async () => {
      if (!this.busy) await git(repo, ["fetch", "--quiet", "--no-tags"]);
      this.dirty = true;
    }));
    cx.timer.every(3000, (cx) => { if (this.dirty) { this.dirty = false; this.refresh(cx); } });
    this.dirty = false;
    this.refresh(cx);
    // Shortcuts (keys.json, layout:dev): act on the focused terminal's repo, otherwise the space's first
    cx.spawn(async (cx) => {
      const acts = { fetch: ["Fetch  ⌘⌥F", () => this.fetch()], pull: [null, () => this.pullBase()],
                     push: ["Push  ⌘⌥U", () => this.push()], clean: ["Clean up  ⌘⌥K", () => this.clean()] };
      for (;;) {
        const c = await nextCommand();
        if (acts[c] && this.isTarget()) this.act(cx, acts[c][0] ?? `Pull ${this.base ?? ""}  ⌘⌥P`, acts[c][1]);
      }
    });
    // GitLab (MR + branch pipeline): 30 s is enough, it is a remote API
    cx.timer.every(30000, (cx) => this.gitlab(cx));
    this.gitlab(cx);
  }

  refresh(cx) {
    const { repo } = props();
    if (!repo) return;
    cx.spawn(async (cx) => {
      // Base branch: prop, otherwise develop if it exists on origin, otherwise the default branch
      if (!this.base) {
        const dev = await git(repo, ["rev-parse", "--verify", "--quiet", "origin/develop"]);
        const head = await git(repo, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
        this.base = props().base ?? (dev.code === 0 ? "develop" : head.stdout.trim().replace(/^origin\//, "") || "main");
      }
      const [b, ab, st] = await Promise.all([
        git(repo, ["branch", "--show-current"]),
        git(repo, ["rev-list", "--left-right", "--count", "HEAD...@{u}"]),
        git(repo, ["status", "--porcelain"]),
      ]);
      // HEAD or refs moved (commit, checkout, fetch): refresh the serie graph
      const refs = (await git(repo, ["show-ref", "--head", "-s"])).stdout;
      if (this.refs !== undefined && refs !== this.refs && props().terminal) await hc(["keys", props().terminal, "shift+r"]);
      this.refs = refs;
      const [ahead, behind] = ab.code === 0 ? ab.stdout.trim().split(/\s+/).map(Number) : [null, null];
      // Linked worktrees (excluding the main one): path + branch
      const wt = (await git(repo, ["worktree", "list", "--porcelain"])).stdout.split("\n\n")
        .map((blk) => ({ path: blk.match(/^worktree (.+)$/m)?.[1], branch: blk.match(/^branch refs\/heads\/(.+)$/m)?.[1] }))
        .filter((w) => w.path && w.path !== repo);
      // Latest test results (Playwright, Vitest, PHPUnit), read from disk by hk-tests
      let tests = [];
      try { tests = JSON.parse((await exec(`${home()}/.local/bin/hk-tests`, [repo])).stdout || "[]"); } catch { /* nothing */ }
      const branch = b.stdout.trim();
      // Recent local branches (picker), pushed or not, lag behind the base, project web URL
      const [br, up, bb, origin] = await Promise.all([
        git(repo, ["for-each-ref", "--sort=-committerdate", "--count=15", "--format=%(refname:short)|%(committerdate:relative)", "refs/heads"]),
        git(repo, ["rev-parse", "--abbrev-ref", "@{u}"]),
        branch && branch !== this.base ? git(repo, ["rev-list", "--count", `HEAD..origin/${this.base}`]) : Promise.resolve({ stdout: "0", code: 0 }),
        this.web ? Promise.resolve(null) : git(repo, ["remote", "get-url", "origin"]),
      ]);
      if (origin && !origin.code) this.web = webUrl(origin.stdout.trim());
      const branches = br.stdout.split("\n").filter(Boolean).map((l) => { const [name, when] = l.split("|"); return { name, when }; });
      this.s = { branch, ahead, behind, dirty: st.stdout.split("\n").filter(Boolean).length, wt, tests,
                 branches, pushed: up.code === 0, behindBase: Number(bb.stdout.trim()) || 0 };
      this.loading = false;
      this.saveCache();
      cx.notify();
    });
  }

  gitlab(cx) {
    const { repo } = props();
    if (!repo) return;
    cx.spawn(async (cx) => {
      const branch = this.s.branch || (await git(repo, ["branch", "--show-current"])).stdout.trim();
      if (!branch) return;
      const ref = encodeURIComponent(branch);
      const api = (path) => exec("glab", ["api", path], { cwd: repo })
        .then((r) => (r.code ? null : JSON.parse(r.stdout)))
        .catch(() => null);
      const [mrs, pipes, open] = await Promise.all([
        api(`projects/:id/merge_requests?state=opened&source_branch=${ref}&per_page=1`),
        api(`projects/:id/pipelines?ref=${ref}&per_page=1`),
        api(`projects/:id/merge_requests?state=opened&per_page=20&order_by=updated_at`),
      ]);
      const pipe = pipes?.[0] ?? null;
      // Running pipeline: jobs for progress (CI 4/9) and the list on click
      if (pipe && ["running", "pending", "created", "preparing", "waiting_for_resource"].includes(pipe.status)) {
        pipe.jobs = ((await api(`projects/:id/pipelines/${pipe.id}/jobs?per_page=100`)) ?? [])
          .map((j) => ({ name: j.name, stage: j.stage, status: j.status, web_url: j.web_url }));
      }
      const prev = this.gl.branch === branch ? this.gl.pipe : undefined;
      // Notify when a tracked pipeline goes from running to finished
      if (prev && pipe && prev.id === pipe.id && ["running", "pending", "created"].includes(prev.status)
          && ["success", "failed", "canceled"].includes(pipe.status)) {
        const failed = pipe.status === "failed";
        toast({ title: `${props().label} · pipeline ${pipe.status}`, body: branch, timeout: 15000,
                level: pipe.status === "success" ? "success" : "error",
                actions: [
                  ...(failed ? [{ label: "Voir les jobs", overlay: { mod: "hk-ci", kind: "dialog", width: 1100, height: 760,
                                  props: { repo: props().repo, pipeline: pipe.id, url: pipe.web_url } } }] : []),
                  { label: "Ouvrir", open: pipe.web_url },
                ] });
      }
      const mr = mrs?.[0] ?? null;
      if (mr) {
        // Review: approvals and unresolved blocking discussions
        const [ap, ds] = await Promise.all([
          api(`projects/:id/merge_requests/${mr.iid}/approvals`),
          api(`projects/:id/merge_requests/${mr.iid}/discussions?per_page=100`),
        ]);
        mr.approved = ap?.approved_by?.length ?? 0;
        mr.required = ap?.approvals_required ?? 0;
        mr.open = (ds ?? []).filter((d) => d.notes?.some((n) => n.resolvable && !n.resolved)).length;
      }
      this.gl = { branch, mr, pipe, open: open ?? [] };
      this.saveCache();
      cx.notify();
    });
  }

  saveCache() {
    const { repo } = props();
    if (!repo) return;
    const all = shared("hk.cache.git") ?? {};
    const next = { s: this.s, gl: this.gl, base: this.base };
    if (JSON.stringify(all[repo]) !== JSON.stringify(next)) setShared("hk.cache.git", { ...all, [repo]: next });
  }

  isTarget() {
    const { repo } = props();
    const cwd = focused()?.cwd ?? "";
    const repos = shared("hk.space.repos") ?? [];
    const owner = repos.find((r) => cwd === r || cwd.startsWith(r + "/"));
    return owner ? owner === repo : repos[0] === repo;
  }

  act(cx, name, fn) {
    if (this.busy) return;
    this.busy = name;
    cx.notify();
    cx.spawn(async (cx) => {
      let msg, level = "info";
      try { msg = await fn(); } catch (e) { msg = String(e?.message ?? e); level = "error"; }
      toast({ title: `${props().label} · ${name.split("  ")[0]}`, body: msg, level: level === "info" ? "success" : level, timeout: 6000 });
      if (props().terminal) await hc(["keys", props().terminal, "shift+r"]); // serie: refresh
      this.busy = null;
      this.refresh(cx);
    });
  }

  fetch() {
    return git(props().repo, ["fetch", "--all", "--prune"])
      .then((r) => { if (r.code) throw new Error(r.stderr.trim()); return "Fetch done"; });
  }

  async pullBase() {
    const { repo } = props();
    const base = this.base;
    // On the base branch: pull ff-only. Elsewhere: advance the local base without checkout.
    const r = this.s.branch === base
      ? await git(repo, ["pull", "--ff-only"])
      : await git(repo, ["fetch", "origin", `${base}:${base}`]);
    if (r.code) throw new Error(r.stderr.trim());
    return `${base} up to date`;
  }

  async push() {
    const { repo } = props();
    // Without upstream: first push with -u
    const up = await git(repo, ["rev-parse", "--abbrev-ref", "@{u}"]);
    const r = up.code
      ? await git(repo, ["push", "-u", "origin", this.s.branch])
      : await git(repo, ["push"]);
    if (r.code) throw new Error(r.stderr.trim());
    return `${this.s.branch} pushed`;
  }

  async clean() {
    const { repo } = props();
    const f = await git(repo, ["fetch", "--prune"]);
    if (f.code) throw new Error(f.stderr.trim());
    const r = await git(repo, ["for-each-ref", "--format=%(refname:short) %(upstream:track)", "refs/heads"]);
    const gone = r.stdout.split("\n").filter((l) => l.endsWith("[gone]")).map((l) => l.split(" ")[0])
      .filter((b) => b !== this.s.branch);
    if (!gone.length) return "No stale branches";
    // Remote deleted (MR merged, often squashed): -D, since -d would see them as unmerged.
    // ponytail: unpushed local commits on these branches are lost, a choice the user accepts
    const done = [], failed = [];
    for (const b of gone) ((await git(repo, ["branch", "-D", b])).code ? failed : done).push(b);
    return [done.length && `Deleted: ${done.join(", ")}`,
            failed.length && `Failed: ${failed.join(", ")}`]
      .filter(Boolean).join("\n");
  }

  // Icon from the icons/ folder, tinted with the text color
  icon(name, size = 13) {
    return svg(`mods/hk-git-bar/icons/${name}.svg`).size(size).flex_none();
  }

  // Pill: icon + text, tooltip, optional click
  chip(t, id, name, text, color, tip, onClick) {
    let el = h_flex().id(id).flex_none().gap(4).px(5).h(22).rounded(5).items_center().text_size(11.5).text_color(color)
      .tooltip(tip).child(this.icon(name)).when(text !== "" && text != null, (e) => e.child(String(text)));
    if (onClick) el = el.hover((s) => s.bg(t.hover)).on_click(onClick);
    return el;
  }

  button(t, id, name, tip, fn) {
    const busy = this.busy === tip;
    return div().id(id).w(26).h(24).rounded(5).flex().items_center().justify_center()
      .text_color(busy ? t.accent : this.busy ? t.dim : t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip(tip)
      .child(busy ? this.icon("ci-run", 14).spin(800) : this.icon(name, 14))
      .on_click((_e, cx) => this.act(cx, tip, fn));
  }

  // Current branch's MR: number, approvals, open discussions
  mrChip(t, mr) {
    const ok = mr.approved >= mr.required;
    return h_flex().gap(2).items_center()
      .child(this.chip(t, "mr", "merge-request", `!${mr.iid}`, t.accent, `MR !${mr.iid} de cette branche : ${mr.title}`, () => exec("open", [mr.web_url])))
      .when(mr.required > 0 || mr.approved > 0, (e) => e.child(
        this.chip(t, "mr-ok", "approve", `${mr.approved}/${mr.required}`, ok ? t.done : t.muted, `Approbations : ${mr.approved} sur ${mr.required} requises`)))
      .when(mr.open > 0, (e) => e.child(this.chip(t, "mr-th", "comment", mr.open, t.working, `${mr.open} discussion(s) non résolue(s)`)));
  }

  // All open MRs of the repo: links popup
  openMrs(t, list) {
    const ST = { mergeable: ["✓", "done", "prête"], not_approved: ["○", "muted", "à approuver"], discussions_not_resolved: ["●", "working", "discussions"],
                 ci_still_running: ["◐", "working", "CI en cours"], ci_must_pass: ["✗", "blocked", "CI en échec"], conflict: ["⚠", "blocked", "conflit"],
                 need_rebase: ["⚠", "blocked", "rebase"], draft_status: ["✎", "dim", "brouillon"] };
    const items = list.map((m) => {
      const [icon, tone, what] = ST[m.detailed_merge_status] ?? ["·", "dim", ""];
      return { icon, tone, label: m.title, sub: `!${m.iid} · ${m.source_branch}${what ? ` · ${what}` : ""} · ${m.author?.name ?? ""}`, open: m.web_url };
    });
    return this.chip(t, "mrs", "merge-request", list.length, t.dim, `${list.length} MR ouverte(s) sur ${props().label}`,
      () => openOverlay({ mod: "hk-list", kind: "popup", width: 440, height: Math.min(460, 44 + items.length * 46),
                          props: { title: `MR ouvertes · ${props().label}`, items } }));
  }

  // One pill per test suite: green if the last run passed, red with the failure count; click = details and rerun
  testChip(t, r, i) {
    const n = r.failed?.length ?? 0;
    const ago = Math.round((Date.now() - r.at * 1000) / 60000);
    const when = ago < 60 ? `il y a ${ago} min` : ago < 1440 ? `il y a ${Math.round(ago / 60)} h` : `il y a ${Math.round(ago / 1440)} j`;
    const term = (argv, name) => ({ run: "terminal.open", args: { argv, folder: r.folder, place: "tab", name } });
    const items = [
      ...(r.rerun_failed ? [{ icon: "↻", tone: "blocked", label: `Relancer les ${n} en échec`, sub: r.rerun_failed.join(" "), ...term(r.rerun_failed, `${r.label} échecs`) }] : []),
      { icon: "▶", tone: "dim", label: "Relancer toute la suite", sub: r.rerun.join(" "), ...term(r.rerun, r.label) },
      ...(r.failed ?? []).slice(0, 8).map((f) => ({ icon: "✗", tone: "blocked", label: f.split(/[\\/:]/).pop(), sub: f })),
    ];
    return h_flex().id(`test-${i}`).flex_none().gap(4).px(5).h(22).rounded(5).items_center().text_size(11.5)
      .text_color(r.ok ? (t.ansi2 ?? t.done) : t.blocked).hover((x) => x.bg(t.hover))
      .tooltip(`${r.label} ${r.ok ? "passés" : `en échec (${n})`} · dernier run ${when}`)
      .on_click(() => openOverlay({ mod: "hk-list", kind: "popup", width: 420, height: Math.min(520, 44 + items.length * 46),
                                    props: { title: `${r.label} · ${r.ok ? "passés" : `${n} en échec`} · ${when}`, items } }))
      .child(this.icon(r.ok ? "ci-ok" : "ci-fail")).child(n ? `${r.label} ${n}` : r.label);
  }

  // 1. Branch picker: recent local branches; automatic stash if files are modified
  branchMenu() {
    const { repo, label } = props(), s = this.s;
    const used = new Map((s.wt ?? []).filter((w) => w.branch).map((w) => [w.branch, w.path.split("/").pop()]));
    const dirty = s.dirty > 0;
    const items = (s.branches ?? []).filter((b) => b.name !== s.branch).map((b) => {
      const busy = used.get(b.name);
      return { icon: "⎇", tone: busy ? "dim" : "accent", label: b.name, disabled: Boolean(busy),
               sub: busy ? `ouverte dans le worktree ${busy}` : `${b.when}${dirty ? " · modifs mises de côté (stash)" : ""}`,
               cwd: repo, done: `${label} · ${b.name}`,
               exec: `${dirty ? `git stash push -u -m ${q(`hk: avant ${b.name}`)} && ` : ""}git switch ${q(b.name)}` };
    });
    openOverlay({ mod: "hk-list", kind: "popup", width: 400, height: Math.min(520, 44 + Math.max(1, items.length) * 46),
                  props: { title: `Changer de branche · ${label}`, items } });
  }

  // 3. Behind the base: rebase or merge in a tab (conflicts stay visible)
  baseMenu() {
    const { repo } = props(), base = this.base;
    const term = (cmd, name) => ({ run: "terminal.open", args: { argv: ["sh", "-c", `${cmd}; exec $SHELL`], folder: repo, place: "tab", name } });
    const items = [
      { icon: "⤓", tone: "accent", label: `Rebase sur origin/${base}`, sub: `git fetch && git rebase origin/${base}`, ...term(`git fetch origin ${base} && git rebase origin/${base}`, "rebase") },
      { icon: "⇣", tone: "dim", label: `Merge origin/${base}`, sub: `git fetch && git merge origin/${base}`, ...term(`git fetch origin ${base} && git merge origin/${base}`, "merge") },
    ];
    openOverlay({ mod: "hk-list", kind: "popup", width: 340, height: 44 + items.length * 46,
                  props: { title: `${this.s.behindBase} commit(s) de retard sur ${base}`, items } });
  }

  // 8. Right click: copy the branch, VS Code, GitLab, terminal
  contextMenu() {
    const { repo, label } = props(), s = this.s;
    const items = [
      { icon: "⧉", tone: "dim", label: "Copier le nom de branche", sub: s.branch, cwd: repo, exec: `printf %s ${q(s.branch)} | pbcopy`, done: "Branche copiée" },
      { icon: "◇", tone: "accent", label: "Ouvrir dans VS Code", sub: repo, cwd: repo, exec: `/usr/local/bin/code ${q(repo)}`, done: `${label} ouvert dans VS Code` },
      ...(this.web ? [{ icon: "↗", tone: "dim", label: "Ouvrir dans GitLab", sub: this.web, open: `${this.web}/-/tree/${encodeURIComponent(s.branch)}` }] : []),
      { icon: "›_", tone: "dim", label: "Nouveau terminal ici", sub: repo, run: "terminal.open", args: { folder: repo, place: "tab" } },
    ];
    openOverlay({ mod: "hk-list", kind: "popup", width: 360, height: 44 + items.length * 46, props: { title: label, items } });
  }

  pipeChip(t, p) {
    const live = ["running", "pending", "created", "preparing", "waiting_for_resource"].includes(p.status);
    const map = { success: ["ci-ok", t.done, "Pipeline réussi"], failed: ["ci-fail", t.blocked, "Pipeline en échec : clic pour les jobs"],
                  canceled: ["ci-skip", t.dim, "Pipeline annulé"], skipped: ["ci-skip", t.dim, "Pipeline ignoré"], manual: ["ci-skip", t.muted, "Pipeline manuel"] };
    const jobs = p.jobs ?? [];
    const done = jobs.filter((j) => ["success", "skipped", "manual"].includes(j.status)).length;
    const [name, color, tip] = live ? ["ci-run", t.working, `Pipeline en cours · ${done}/${jobs.length} jobs`] : (map[p.status] ?? ["ci-skip", t.muted, `Pipeline ${p.status}`]);
    const ST = { success: ["✓", "done"], failed: ["✗", "blocked"], running: ["◐", "working"], pending: ["○", "dim"], created: ["○", "dim"],
                 skipped: ["⊘", "dim"], canceled: ["⊘", "dim"], manual: ["▸", "muted"] };
    const open = () => {
      if (p.status === "failed") return openOverlay({ mod: "hk-ci", kind: "dialog", width: 1100, height: 760, props: { repo: props().repo, pipeline: p.id, url: p.web_url } });
      if (!live || !jobs.length) return exec("open", [p.web_url]);
      const items = jobs.map((j) => { const [icon, tone] = ST[j.status] ?? ["·", "dim"]; return { icon, tone, label: j.name, sub: `${j.stage} · ${j.status}`, open: j.web_url }; });
      openOverlay({ mod: "hk-list", kind: "popup", width: 380, height: Math.min(520, 44 + items.length * 46), props: { title: `Pipeline · ${done}/${jobs.length}`, items } });
    };
    return h_flex().id("ci").flex_none().gap(4).px(5).h(22).rounded(5).items_center().text_size(11.5).text_color(color)
      .tooltip(tip).hover((s) => s.bg(t.hover)).on_click(open)
      .child(live ? this.icon("ci-run").spin(900) : this.icon(name)).child(live && jobs.length ? `CI ${done}/${jobs.length}` : "CI");
  }

  render() {
    const t = theme(), p = props(), s = this.s;
    const label = p.label ?? "git";
    // First display without cache: animated skeleton rather than an empty header
    if (this.loading && !s.branch) {
      const bar = (w, d) => div().w(w).h(8).rounded(4).bg(t.raised).loop("opacity", { from: 0.35, to: 0.9, period: 1100 + d });
      return h_flex().id("root").size_full().px(12).gap(10).items_center().bg(t.chrome).border_b(1).border_color(t.border)
        .child(div().flex_none().text_size(12.5).font_semibold().text_color(t.foreground).child(label))
        .child(bar(140, 0)).child(div().flex_1()).child(bar(36, 150)).child(bar(36, 300)).child(bar(90, 450));
    }
    const short = (path) => { const n = path.split("/").pop(); return n.startsWith(label + "-") ? n.slice(label.length + 1) : n; };
    const wt = s.wt ?? [];
    return h_flex().id("root").size_full().px(12).gap(6).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.contextMenu(); })
      .child(div().flex_none().text_size(12.5).font_semibold().text_color(t.foreground).child(label))
      .child(h_flex().flex_1().min_w(0)
        .child(div().id("branch").min_w(0).truncate().px(4).rounded(4).text_size(11.5).text_color(t.muted)
          .hover((x) => x.bg(t.hover).text_color(t.foreground)).tooltip("Changer de branche")
          .child(s.branch ? `⎇ ${s.branch}` : "").on_click(() => this.branchMenu())))
      .when(s.ahead > 0, (e) => e.child(this.chip(t, "ahead", "ahead", s.ahead, t.done, `${s.ahead} commit(s) à pousser`)))
      .when(s.behind > 0, (e) => e.child(this.chip(t, "behind", "behind", s.behind, t.blocked, `${s.behind} commit(s) à récupérer`)))
      .when(s.dirty > 0, (e) => e.child(this.chip(t, "dirty", "modified", s.dirty, t.working, `${s.dirty} fichier(s) modifié(s) : clic pour les diffs`,
        () => openOverlay({ mod: "hk-diff", kind: "dialog", width: 1300, height: 820, props: { repo: p.repo, label } }))))
      .when(s.behindBase > 0, (e) => e.child(this.chip(t, "base", "behind", `${this.base} ${s.behindBase}`, t.muted,
        `${s.behindBase} commit(s) de retard sur origin/${this.base} : clic pour rebase ou merge`, () => this.baseMenu())))
      .when(!!this.gl?.mr, (e) => e.child(this.mrChip(t, this.gl.mr)))
      .when(!this.gl?.mr && s.pushed && this.web && s.branch && s.branch !== this.base && this.gl?.branch === s.branch, (e) => e.child(
        this.chip(t, "mr-new", "merge-request", "Créer la MR", t.accent, `Nouvelle MR ${s.branch} → ${this.base}`,
          () => exec("open", [`${this.web}/-/merge_requests/new?merge_request[source_branch]=${encodeURIComponent(s.branch)}&merge_request[target_branch]=${encodeURIComponent(this.base)}`]))))
      .when(!!this.gl?.pipe, (e) => e.child(this.pipeChip(t, this.gl.pipe)))
      .children((s.tests ?? []).map((r, i) => this.testChip(t, r, i)))
      .when((this.gl?.open ?? []).length > 0, (e) => e.child(this.openMrs(t, this.gl.open)))
      .when(wt.length > 0, (e) => e.child(this.chip(t, "wt", "worktree", wt.length, t.dim, `${wt.length} worktree(s) : clic pour en ouvrir un`,
        () => openOverlay({ mod: "hk-worktrees", kind: "popup", width: 260, height: 16 + wt.length * 44,
          props: { items: wt.map((w) => ({ path: w.path, label: short(w.path), branch: w.branch })) } }))))
      .child(div().w(1).h(16).mx(4).flex_none().bg(t.border))
      .child(this.button(t, "fetch", "fetch", "Fetch  ⌘⌥F", () => this.fetch()))
      .child(this.button(t, "pull", "pull", `Pull ${this.base ?? ""}  ⌘⌥P`, () => this.pullBase()))
      .child(this.button(t, "push", "push", "Push  ⌘⌥U", () => this.push()))
      .child(this.button(t, "clean", "clean", "Clean up : branches supprimées sur GitLab  ⌘⌥K", () => this.clean()));
  }
}
