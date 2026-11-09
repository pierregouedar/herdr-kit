// Kit notifications (floating block, top right): per-type edge, action buttons.
// Other mods push into shared "hk.toasts":
//   { id, level: "success"|"error"|"warning"|"info", title, body, until, actions: [{ label, open?, run?, args?, overlay? }] }
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, openOverlay, run, setShared, shared, theme } from "herdr";

const TONE = { success: "done", error: "blocked", warning: "working", info: "accent" };

export default class HkToasts extends View {
  init(_p, cx) {
    // Expiry: one pass per second, only if there are notifications
    cx.timer.every(1000, () => {
      const list = shared("hk.toasts") ?? [];
      const live = list.filter((x) => !x.until || x.until > Date.now());
      if (live.length !== list.length) setShared("hk.toasts", live);
    });
  }

  dismiss(id) {
    setShared("hk.toasts", (shared("hk.toasts") ?? []).filter((x) => x.id !== id));
  }

  act(n, a) {
    if (a.open) exec("open", [a.open]);
    if (a.run) run(a.run, a.args ?? {});
    if (a.overlay) openOverlay(a.overlay);
    this.dismiss(n.id);
  }

  card(t, n) {
    const tone = t[TONE[n.level] ?? "accent"];
    return h_flex().id(`t-${n.id}`).w(360).rounded(8).bg(t.popover).border(1).border_color(t.border).overflow_hidden()
      .child(div().w(3).h_full().flex_none().bg(tone))
      .child(v_flex().flex_1().min_w(0).px(12).py(9).gap(4)
        .child(h_flex().gap(8).items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_semibold().text_color(t.foreground).child(n.title))
          .child(div().id(`x-${n.id}`).px(4).rounded(4).text_size(12).text_color(t.dim).hover((s) => s.text_color(t.foreground))
            .child("×").on_click(() => this.dismiss(n.id))))
        .when(Boolean(n.body), (e) => e.child(div().text_size(11.5).text_color(t.muted).child(n.body)))
        .when((n.actions ?? []).length > 0, (e) => e.child(h_flex().gap(6).pt(2)
          .children(n.actions.map((a, i) => div().id(`a-${n.id}-${i}`).px(8).py(3).rounded(5).text_size(11.5)
            .bg(i === 0 ? tone + "26" : t.surface).text_color(i === 0 ? tone : t.foreground)
            .hover((s) => s.bg(t.hover)).child(a.label).on_click(() => this.act(n, a)))))));
  }

  render() {
    const t = theme();
    const list = (shared("hk.toasts") ?? []).slice(-4);
    if (!list.length) return div();
    return v_flex().gap(8).p(2).children(list.map((n) => this.card(t, n)));
  }
}
