// Modal: failed jobs of a GitLab pipeline and the end of their log. props: { repo, pipeline, url, overlay }
import { View, div } from "gpui-kit";
import { h_flex, v_flex, TextView } from "gpui-base";
import { closeOverlay, exec, props as rawProps, theme } from "herdr";

const props = () => rawProps() ?? {};
const TAIL = 60;
// GitLab log: ANSI colors and section markers to strip
const clean = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/section_(start|end):\d+:[^\r\n]*\r?/g, "").replace(/\r/g, "");

export default class HkCi extends View {
  init(_p, cx) {
    this.md = "Chargement…";
    const { repo, pipeline } = props();
    if (!repo || !pipeline) return;
    cx.spawn(async (cx) => {
      const api = (path) => exec("glab", ["api", path], { cwd: repo });
      const jr = await api(`projects/:id/pipelines/${pipeline}/jobs?scope[]=failed&per_page=20`);
      let jobs = [];
      try { jobs = JSON.parse(jr.stdout); } catch { /* empty */ }
      if (!jobs.length) { this.md = "_Aucun job en échec._"; cx.notify(); return; }
      const parts = [];
      for (const j of jobs) {
        const tr = await api(`projects/:id/jobs/${j.id}/trace`);
        const tail = clean(tr.stdout).split("\n").filter((l) => l.trim()).slice(-TAIL).join("\n");
        parts.push(`### ✗ ${j.stage} · ${j.name}\n[Ouvrir le job](${j.web_url})\n\n\`\`\`\n${tail}\n\`\`\``);
      }
      this.md = parts.join("\n\n");
      cx.notify();
    });
  }

  render() {
    const t = theme(), p = props();
    return v_flex().id("root").size_full().bg(t.background).rounded(10)
      .child(h_flex().h(40).px(14).gap(10).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().text_size(13).font_semibold().text_color(t.blocked).child(`Pipeline #${p.pipeline ?? "?"} en échec`))
        .when(!!p.url, (e) => e.child(div().id("open").px(8).py(2).rounded(5).text_size(11.5).border(1).border_color(t.border)
          .text_color(t.foreground).hover((s) => s.bg(t.hover)).child("Ouvrir dans GitLab").on_click(() => exec("open", [p.url]))))
        .child(div().id("close").px(8).py(2).rounded(5).text_color(t.muted).hover((s) => s.bg(t.hover)).child("Esc")
          .on_click(() => closeOverlay(p.overlay))))
      .child(div().id("body").flex_1().p(16).overflow_y_scrollbar()
        .child(TextView.markdown("ci", this.md).selectable(true)));
  }
}
