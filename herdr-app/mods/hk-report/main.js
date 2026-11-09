// Popup: report (last message) of a subagent. props: { log, title, overlay }
import { View, div } from "gpui-kit";
import { h_flex, v_flex, TextView } from "gpui-base";
import { closeOverlay, exec, home, props as rawProps, shared, theme } from "herdr";

// Props of the click on a row, otherwise the last report announced by a notification (mod.open)
const props = () => ({ ...(shared("hk.report") ?? {}), ...(rawProps() ?? {}) });

export default class HkReport extends View {
  init(_p, cx) {
    this.text = "Chargement…";
    const { log } = props();
    if (!log) return;
    cx.spawn(async (cx) => {
      const r = await exec(`${home()}/.local/bin/hk-agents`, ["--report", log]);
      this.text = r.code ? r.stderr : r.stdout;
      cx.notify();
    });
  }

  render() {
    const t = theme(), p = props();
    return v_flex().id("root").size_full().bg(t.background).rounded(10)
      .child(h_flex().h(40).px(14).gap(10).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().truncate().text_size(13).font_semibold().text_color(t.foreground).child(p.title ?? "Subagent"))
        .child(div().id("close").px(8).py(2).rounded(5).text_color(t.muted).hover((s) => s.bg(t.hover)).child("Esc")
          .on_click(() => closeOverlay(p.overlay))))
      .child(div().id("body").flex_1().p(16).overflow_y_scrollbar()
        .child(TextView.markdown("report", this.text).selectable(true)));
  }
}
