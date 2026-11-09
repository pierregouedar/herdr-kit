// Claude usage in the bottom bar: today's cost, 5 h and 7 d limits (written by the status line).
import { View, div, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, home, openOverlay, setShared, shared, theme, watchFolder } from "herdr";

export default class HkUsage extends View {
  init(_p, cx) {
    this.u = shared("hk.cache.usage") ?? null; // last known values: no empty bar on reload
    const load = (cx) => cx.spawn(async (cx) => {
      const r = await exec(`${home()}/.local/bin/hk-agents`, ["--cost"]);
      try {
        this.u = JSON.parse(r.stdout);
        if (JSON.stringify(shared("hk.cache.usage")) !== JSON.stringify(this.u)) setShared("hk.cache.usage", this.u);
      } catch { /* keep the previous display */ }
      cx.notify();
    });
    // Re-read as soon as the status line writes (~/.claude/cost), at most every 2 s; safety net every 60 s
    this.dirty = true;
    // Claude (status line), Codex and omp: re-read as soon as one of them writes
    for (const dir of [".claude/cost", ".codex/sessions", ".omp/agent/sessions"]) {
      cx.spawn(async () => { for (;;) { try { await watchFolder(`${home()}/${dir}`); } catch { break; /* folder missing: the periodic re-reads are enough */ } this.dirty = true; } });
    }
    cx.timer.every(2000, (cx) => { if (this.dirty) { this.dirty = false; load(cx); } });
    cx.timer.every(60000, load);
  }

  meter(t, label, pct, hint) {
    const color = pct >= 80 ? t.blocked : pct >= 50 ? t.working : (t.ansi2 ?? t.done);
    return h_flex().gap(5).items_center()
      .child(div().text_size(11).text_color(t.dim).child(label))
      .child(div().w(40).h(4).rounded(2).bg(t.raised)
        .child(div().h(4).rounded(2).bg(color).w(Math.max(2, Math.round(40 * Math.min(pct, 100) / 100)))))
      .child(div().text_size(11).text_color(t.muted).child(`${pct}%${hint ? ` · ${hint}` : ""}`));
  }

  // An agent: logo, 5 h limit (with reset) and 7 d
  agent(t, logo, raw, extra) {
    // 5 h window already reset since the last write (Claude idle): 0 %
    const u = raw.rl5_reset && raw.rl5_reset * 1000 < Date.now() ? { ...raw, rl5: 0 } : raw;
    const reset = u.rl5_reset && u.rl5 > 0 ? new Date(u.rl5_reset * 1000).toTimeString().slice(0, 5) : null;
    return h_flex().gap(10).items_center()
      .child(image(logo).w(14).h(14).flex_none())
      .when(Boolean(extra), (e) => e.child(extra))
      .when(u.rl5 >= 0, (e) => e.child(this.meter(t, "5h", u.rl5, reset && `↺ ${reset}`)))
      .when(u.rl7 >= 0, (e) => e.child(this.meter(t, "7d", u.rl7)));
  }

  render() {
    const t = theme(), u = this.u;
    const row = h_flex().id("root").size_full().bg(t.chrome).border_t(1).border_l(1).border_color(t.border)
      .px(14).gap(18).items_center().justify_end();
    if (!u) return row;
    return row
      .child(this.agent(t, "icons/claude.svg", u,
        div().id("cost").px(4).rounded(4).text_size(11.5).text_color(t.foreground).hover((x) => x.bg(t.hover))
          .tooltip("Coût IA du jour : clic pour les 7 derniers jours").child(`$${u.today.toFixed(2)}`)
          .on_click(() => openOverlay({ mod: "hk-history", kind: "popup", width: 560, height: 330 }))))
      .when(Boolean(u.codex), (e) => e
        .child(div().w(1).h(14).bg(t.border))
        .child(this.agent(t, "icons/codex.svg", u.codex)));
  }
}
