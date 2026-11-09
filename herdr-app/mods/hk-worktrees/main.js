// Popup: worktrees of a repo; click = go to the worktree's space, otherwise create one. props: { items: [{path, label, branch}] }
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { closeOverlay, props as rawProps, run, spaces, theme } from "herdr";

const props = () => rawProps() ?? {};

export default class HkWorktrees extends View {
  open(path) {
    const sp = spaces().find((x) => !x.machine && x.folder?.startsWith(path));
    if (sp) run("space.select", { id: sp.id });
    else run("space.new", { folder: path });
    closeOverlay(props().overlay);
  }

  render() {
    const t = theme();
    return v_flex().id("root").size_full().px(4).pt(6).pb(10).gap(0).bg(t.popover)
      .children((props().items ?? []).map((w, i) =>
        v_flex().id(`w${i}`).h(44).flex_none().justify_center().px(10).rounded(5).hover((s) => s.bg(t.hover))
          .on_click(() => this.open(w.path))
          .child(div().text_size(12.5).text_color(t.foreground).child(w.label))
          .child(div().text_size(11).text_color(t.dim).truncate().child(w.branch ?? "détachée"))));
  }
}
