// Height to give the popup: 44 + 46 per entry (title 28, rows 46, margins 16)
// Generic popup: list of links or actions.
// props: { title, items: [{ icon, tone, label, sub, open?, run?+args?, exec?+cwd?+done?, disabled? }] }
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { closeOverlay, exec, props as rawProps, run, setShared, shared, theme } from "herdr";

const props = () => rawProps() ?? {};

export default class HkList extends View {
  render() {
    const t = theme(), p = props();
    return v_flex().id("root").size_full().overflow_y_scrollbar().px(4).pt(6).pb(10).gap(0).bg(t.popover)
      .when(Boolean(p.title), (e) => e.child(div().h(28).flex_none().px(10).flex().items_center().text_size(10.5).font_semibold().text_color(t.dim).child(p.title.toUpperCase())))
      .children((p.items ?? []).map((it, i) =>
        h_flex().id(`i${i}`).h(46).flex_none().px(10).gap(8).items_center().rounded(5).hover((s) => s.bg(t.hover))
          .when(Boolean(it.disabled), (e) => e.opacity(0.45))
          .on_click((_e, cx) => {
            if (it.disabled) return;
            if (it.open) exec("open", [it.open]);
            if (it.run) run(it.run, it.args ?? {});
            if (it.exec) cx.spawn(async () => {
              // Shell command: result as a notification (hk-toasts)
              const r = await exec("sh", ["-c", it.exec], { cwd: it.cwd });
              const out = (r.code ? r.stderr || r.stdout : r.stdout || r.stderr).trim().split("\n").slice(-3).join(" · ");
              setShared("hk.toasts", [...(shared("hk.toasts") ?? []), { id: `x${Date.now()}`, until: Date.now() + 7000,
                level: r.code ? "error" : "success", title: it.done ?? it.label, body: out.slice(0, 200) }]);
            });
            closeOverlay(p.overlay);
          })
          .child(div().w(14).flex_none().text_size(12.5).text_color(t[it.tone] ?? t.dim).child(it.icon ?? "·"))
          .child(v_flex().flex_1().min_w(0)
            .child(div().truncate().text_size(12.5).text_color(t.foreground).child(it.label))
            .child(div().truncate().text_size(11).text_color(t.dim).child(it.sub ?? "")))));
  }
}
