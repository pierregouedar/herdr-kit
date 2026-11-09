// Popup: AI cost over the last 7 days, stacked Claude / omp bars (data: hk-agents --history).
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, home, theme } from "herdr";

const JOURS = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];
const H = 170; // usable bar height, px

export default class HkHistory extends View {
  init(_p, cx) {
    this.days = null;
    cx.spawn(async (cx) => {
      const r = await exec(`${home()}/.local/bin/hk-agents`, ["--history"]);
      try { this.days = JSON.parse(r.stdout); } catch { this.days = []; }
      cx.notify();
    });
  }

  render() {
    const t = theme();
    const root = v_flex().id("root").size_full().p(16).gap(12).bg(t.popover);
    if (!this.days) return root.child(div().text_size(12).text_color(t.dim).child("Chargement…"));
    const claude = t.ansi3 ?? t.working, omp = t.ansi5 ?? t.accent;
    const max = Math.max(1, ...this.days.map((d) => d.claude + d.omp));
    const total = this.days.reduce((n, d) => n + d.claude + d.omp, 0);
    const legend = (c, l) => h_flex().gap(5).items_center().child(div().w(8).h(8).rounded(2).bg(c)).child(div().text_size(11).text_color(t.muted).child(l));
    return root
      .child(h_flex().items_center().gap(12)
        .child(div().flex_1().text_size(13).font_semibold().text_color(t.foreground).child(`7 derniers jours · $${total.toFixed(2)}`))
        .child(legend(claude, "Claude")).child(legend(omp, "omp")))
      .child(h_flex().h(H + 40).gap(10).items_end()
        .children(this.days.map((d, i) => {
          const sum = d.claude + d.omp;
          const date = new Date(`${d.day}T12:00:00`);
          const today = i === this.days.length - 1;
          return v_flex().id(`d${i}`).flex_1().h_full().justify_end().items_center().gap(4)
            .tooltip(`${d.day} · Claude $${d.claude.toFixed(2)} · omp $${d.omp.toFixed(2)}`)
            .child(div().text_size(10.5).text_color(today ? t.foreground : t.dim).child(sum ? `$${Math.round(sum)}` : ""))
            .child(v_flex().w(34).rounded(4).overflow_hidden()
              .child(div().w_full().h(Math.round((d.omp / max) * H)).bg(omp))
              .child(div().w_full().h(Math.round((d.claude / max) * H)).bg(claude)))
            .child(div().text_size(10.5).text_color(today ? t.foreground : t.dim).child(`${JOURS[date.getDay()]} ${date.getDate()}`));
        })))
      .child(div().text_size(10.5).text_color(t.dim).child("Claude : depuis le 2 novembre (enregistré par la status line). omp : lu dans ses sessions."));
  }
}
