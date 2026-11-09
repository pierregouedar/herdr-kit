// A pane's header, for layouts that frame their panes:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "hk-pane" } } } }
// Shows the program's icon (the app's program table), the agent's name or
// the terminal's title, the folder, and the agent's status; buttons split, zoom and close
// this pane. Props from the app: { pane, terminal }. Click: focus the pane.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { panes, props, run, shared, terminals, theme, home } from "herdr";

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

function since(ms) {
  if (!ms) return "";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
}

export default class Pane extends View {
  init(_p, cx) {
    this.hovered = false;
    // "Since" duration: redrawn every 15 s only (the rest is animated natively)
    cx.timer.every(15000, (cx) => cx.notify());
  }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  button(t, id, icon, command, args) {
    return div()
      .id(id)
      .p(3)
      .rounded(4)
      .text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run(command, args);
      })
      .child(svg(`mods/hk-pane/${icon}.svg`).size(14));
  }

  render(cx) {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    const name = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
    const pic = icon(p.program, 14, t.dim);
    const st = p.status;
    const pane = p.pane;
    const term = terminals().find((x) => x.address === p.terminal);
    const isAgent = Boolean(p.program?.agent);
    // Agent: session title + what it is doing now; otherwise the folder
    const title = isAgent && p.title && p.title !== name ? p.title : null;
    const msg = isAgent ? term?.status?.msg : null;
    const cost = title ? (shared("hk.session.costs") ?? {})[title] : null;
    const tone = st === "working" ? t.accent : st === "blocked" ? t.blocked : st === "done" ? t.done : null;
    const row = h_flex()
      .flex_1()
      .px(10)
      .gap(8)
      .items_center()
      .text_size(12)
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(220).font_medium().text_color(t.foreground).child(title ?? name))
      .when(Boolean(msg) && st !== "idle", (el) => el.child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(msg)))
      .when(!(msg && st !== "idle"), (el) => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(folder(p.cwd))))
      .when(Boolean(p.branch) && !this.hovered, (el) => el.child(div().flex_none().max_w(200).truncate().text_size(11).text_color(t.dim).child(`⎇ ${p.branch}`)))
      .when(cost != null && !this.hovered, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(`$${cost.toFixed(2)}`)))
      .when(st === "working", (el) => el
        .child(div().flex_none().text_size(11).text_color(t.accent).child(since(term?.status_ms)))
        .child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.accent).spin(900)))
      .when(st === "blocked", (el) => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).child("Needs you")))
      .when(st === "done", (el) => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.done + "22").text_size(10.5).font_semibold().text_color(t.done).child("Done")))
      .when(this.hovered, (el) => el
        .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane })));
    // Bottom edge: breathes in accent when the agent works, pulses orange when it waits for you
    const line = div().h(2).w_full().flex_none().bg(tone ?? t.border)
      .when(st === "working", (el) => el.loop("opacity", { from: 0.25, to: 1, period: 1600 }))
      .when(st === "blocked", (el) => el.loop("opacity", { from: 0.35, to: 1, period: 700 }));
    return v_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .bg(t.background)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .child(row)
      .child(st === "working" || st === "blocked" || st === "done" ? line : div().h(1).w_full().flex_none().bg(t.border));
  }
}
