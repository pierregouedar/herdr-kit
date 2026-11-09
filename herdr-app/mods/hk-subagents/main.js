// Claude Code subagents, grouped by project then session (data: hk-agents --json).
import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, exec, home, nextCommand, openOverlay, run, setShared, shared, spaces, terminals, theme, watchFolder } from "herdr";
// Kit notification (hk-toasts mod): per-type edge and action buttons
const toast = (n) => setShared("hk.toasts", [...(shared("hk.toasts") ?? []),
  { id: `${Date.now()}${Math.random().toString(36).slice(2, 6)}`, until: Date.now() + (n.timeout ?? 8000), ...n }]);


const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const MAX_PER_SESSION = 6;

export default class HkSubagents extends View {
  init(_p, cx) {
    this.groups = [];
    this.error = null;
    this.running = null; // logs running at the last pass (null = first pass, no notification)
    // "hk-subagents.report" (click on the completion notification): opens the last report in a centered dialog
    cx.spawn(async () => {
      for (;;) if ((await nextCommand()) === "report") this.openReport(shared("hk.report") ?? {});
    });
    // Reloaded when a Claude transcript changes, at most every 2 s; nothing at rest
    this.dirty = true;
    for (const dir of [".claude/projects", ".omp/agent/sessions", ".codex/sessions"]) {
      cx.spawn(async () => { for (;;) { try { await watchFolder(`${home()}/${dir}`); } catch { break; /* folder missing: the periodic re-reads are enough */ } this.dirty = true; } });
    }
    cx.timer.every(2000, (cx) => { if (this.dirty) { this.dirty = false; this.load(cx); } });
    // Safety net: an agent that dies without writing goes "idle" after 10 min, rechecked every minute
    cx.timer.every(60000, () => { this.dirty = true; });
  }

  load(cx) {
    cx.spawn(async (cx) => {
      try {
        const r = await exec(`${home()}/.local/bin/hk-agents`, ["--json"]);
        this.groups = JSON.parse(r.stdout || "[]");
        // Codex sessions launched in the space's folders
        const cx2 = await exec(`${home()}/.local/bin/hk-agents`, ["--codex", ...(shared("hk.space.dirs") ?? [])]);
        try { this.codex = JSON.parse(cx2.stdout || "[]"); } catch { this.codex = []; }
        this.notifyFinished();
        this.error = r.code ? r.stderr.trim() : null;
      } catch (e) {
        this.error = String(e?.message ?? e);
      }
      cx.notify();
    });
  }

  all() {
    return this.groups.flatMap((g) => g.sessions.flatMap((s) => s.agents.map((a) => ({ ...a, session: s.title }))));
  }

  notifyFinished() {
    const all = this.all();
    const now = new Set(all.filter((a) => a.state === "running").map((a) => a.log));
    if (this.running) {
      for (const a of all) {
        if (this.running.has(a.log) && a.state === "done") {
          toast({ title: `Subagent terminé · ${a.desc}`, body: `${a.session} · ${a.dur}`, level: "success", timeout: 20000,
                  actions: [{ label: "Lire le rapport", overlay: { mod: "hk-report", kind: "dialog", width: 1100, height: 760,
                                                                    props: { log: a.log, title: a.desc } } }] });
        }
      }
    }
    this.running = now;
  }

  openReport({ log, title }) {
    if (log) openOverlay({ mod: "hk-report", kind: "dialog", width: 1100, height: 760, props: { log, title } });
  }

  icon(t, state) {
    if (state === "running") return div().w(14).text_color(t.working).frames(SPIN, 90);
    if (state === "stale") return div().w(14).text_color(t.dim).child("◌");
    return div().w(14).text_color(t.done).child("✓");
  }

  agentRow(t, a, key) {
    return h_flex().id(key).gap(8).items_center().px(8).h(26).rounded(5)
      .hover((s) => s.bg(t.hover)).tooltip(`${a.kind || "agent"} · clic : dernier message`)
      .on_click(() => this.openReport({ log: a.log, title: a.desc }))
      .child(this.icon(t, a.state))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(a.desc))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(a.state === "stale" ? "stale" : a.dur));
  }

  session(t, s, pk) {
    const shown = s.agents.slice(0, MAX_PER_SESSION);
    return v_flex().gap(0)
      .child(div().px(8).pt(4).pb(1).truncate().text_size(10.5).text_color(t.dim).child(s.title))
      .children(shown.map((a, i) => this.agentRow(t, a, `${pk}-${s.id}-${i}`)))
      .when(s.agents.length > MAX_PER_SESSION, (e) =>
        e.child(div().px(30).text_size(11).text_color(t.dim).child(`+${s.agents.length - MAX_PER_SESSION} more`)));
  }

  // Block height fitted to content: collapsed to its header when nothing is running
  fit(rows) {
    const px = rows ? Math.min(460, 36 + 10 + rows) : 36;
    if (px !== this.px) { this.px = px; run("layout.resize", { id: "subagents", px }); }
  }

  // A Claude session of the space: state, title, what it is doing, cost; click = go to it
  sessionRow(t, a, term, cost) {
    const st = a.status;
    const tone = st === "working" ? t.accent : st === "blocked" ? t.blocked : st === "done" ? (t.ansi2 ?? t.done) : t.dim;
    const mark = st === "working" ? svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(tone).spin(900)
      : div().w(8).h(8).mx(2).rounded(4).flex_none().bg(tone).when(st === "blocked", (e) => e.loop("opacity", { from: 0.35, to: 1, period: 700 }));
    const msg = st === "blocked" ? "attend ta réponse" : st === "working" ? term?.status?.msg : st === "done" ? "terminé" : null;
    return h_flex().id(`s-${a.address}`).h(34).px(8).gap(8).items_center().rounded(6).hover((x) => x.bg(t.hover))
      .tooltip(`${a.tab_name} · clic pour y aller`).on_click(() => run("agent.focus", { terminal: a.address }))
      .child(mark)
      .child(v_flex().flex_1().min_w(0)
        .child(div().truncate().text_size(12.5).font_medium().text_color(t.foreground).child(a.title || a.program?.name || "agent"))
        .when(Boolean(msg), (e) => e.child(div().truncate().text_size(10.5).text_color(st === "blocked" ? t.blocked : t.dim).child(msg))))
      .when(cost != null, (e) => e.child(div().flex_none().text_size(11).text_color(t.dim).child(`$${cost.toFixed(2)}`)));
  }

  // A Codex session: logo, title (1st line), model, state, subagents
  codexRow(t, c, subs) {
    const live = c.state === "running";
    return h_flex().id(`cx-${c.id}`).h(34).px(8).gap(8).items_center().rounded(6).hover((x) => x.bg(t.hover))
      .tooltip(`Codex · ${c.model ?? ""} · ${c.cwd}`)
      .child(image("icons/codex.svg").w(13).h(13).flex_none())
      .child(v_flex().flex_1().min_w(0)
        .child(div().truncate().text_size(12.5).font_medium().text_color(t.foreground).child(c.title))
        .child(div().truncate().text_size(10.5).text_color(live ? t.working : t.dim)
          .child(`${live ? "en cours" : `il y a ${c.ago}`}${subs ? ` · ${subs} sous-agent${subs > 1 ? "s" : ""}` : ""}`)))
      .when(live, (e) => e.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)));
  }

  render() {
    const t = theme();
    const sp = spaces().find((x) => x.active);
    // Claude sessions (and other agents) of the active space
    const mine = agents().filter((a) => a.space === sp?.id);
    const terms = new Map(terminals().map((x) => [x.address, x]));
    const costs = shared("hk.session.costs") ?? {};
    // Active subagents of sessions launched in the space's folders (Claude encodes the cwd: / and . become -)
    const dirs = (shared("hk.space.dirs") ?? []).map((d) => d.replace(/[\/.]/g, "-"));
    const subs = this.groups.filter((g) => dirs.some((d) => g.dir === d || g.dir.startsWith(d + "-")))
      .flatMap((g) => g.sessions).map((x) => ({ ...x, agents: x.agents.filter((a) => a.state === "running") })).filter((x) => x.agents.length);
    const byTitle = new Map(subs.map((x) => [x.title, x]));
    const orphans = subs.filter((x) => !mine.some((a) => a.title === x.title));
    const nSubs = subs.reduce((n, x) => n + Math.min(x.agents.length, MAX_PER_SESSION), 0);
    const codex = (this.codex ?? []).filter((c) => !c.sub).slice(0, 4);
    const codexSubs = (this.codex ?? []).filter((c) => c.sub).length;
    this.fit(mine.length * 34 + nSubs * 26 + orphans.length * 20 + codex.length * 34);
    const working = mine.filter((a) => a.status === "working").length;
    const blocked = mine.filter((a) => a.status === "blocked").length;
    const header = h_flex().h(36).flex_none().px(12).gap(8).items_center().bg(t.chrome)
      .child(div().text_size(12.5).font_semibold().text_color(t.foreground).child("Agents"))
      .when(blocked > 0, (e) => e.child(div().text_size(11.5).text_color(t.blocked).child(`${blocked} waiting`)))
      .child(div().text_size(11.5).text_color(working ? t.working : t.dim).child(working ? `${working} working` : mine.length ? "idle" : "none"))
      .when(nSubs > 0, (e) => e.child(div().text_size(11.5).text_color(t.dim).child(`· ${nSubs} subagent${nSubs > 1 ? "s" : ""}`)))
      .when(!!this.error, (e) => e.child(div().flex_1().truncate().text_size(11).text_color(t.blocked).child(this.error)));
    const body = v_flex().id("agents-body").flex_1().overflow_y_scrollbar().px(4).pb(6)
      .children(mine.map((a) => {
        const sub = byTitle.get(a.title);
        return v_flex()
          .child(this.sessionRow(t, a, terms.get(a.address), costs[a.title]))
          .when(Boolean(sub), (e) => e.child(v_flex().pl(16)
            .children(sub.agents.slice(0, MAX_PER_SESSION).map((x, i) => this.agentRow(t, x, `${a.address}-${i}`)))));
      }))
      .children(orphans.map((x) => this.session(t, x, "o")))
      .children(codex.map((c, i) => this.codexRow(t, c, i === 0 ? codexSubs : 0)));
    return v_flex().id("root").size_full().bg(t.chrome).child(header).when(mine.length + orphans.length + codex.length > 0, (e) => e.child(body));
  }
}
