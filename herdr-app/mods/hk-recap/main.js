// Daily recap: commits per repo (all spaces), MRs touched today, Claude cost per session.
// "Copier" button: the markdown into the clipboard, for a team sync or time tracking.
import { View, div } from "gpui-kit";
import { h_flex, v_flex, TextView } from "gpui-base";
import { closeOverlay, exec, home, panes, props as rawProps, spaces, theme } from "herdr";

const props = () => rawProps() ?? {};
// Repos under each folder: the folder itself if it is in a repo, otherwise its subfolders (worktrees excluded)
const FIND = `
for d in "$@"; do
  top=$(git -C "$d" rev-parse --show-toplevel 2>/dev/null) && { echo "$top"; continue; }
  for s in "$d"/*/; do [ -d "$s.git" ] && echo "\${s%/}"; done
done | awk '!seen[$0]++'
`;

export default class HkRecap extends View {
  init(_p, cx) {
    this.md = "Chargement…";
    this.copied = false;
    cx.spawn(async (cx) => { this.md = await this.build(); cx.notify(); });
  }

  async build() {
    const h = home();
    const today = new Date();
    const day = new Date(Date.now() - 86400000 / 2).toISOString().slice(0, 10); // ponytail: "today's" MRs within 12 h (timezone)
    const dirs = [...new Set([...spaces().filter((s) => !s.machine).map((s) => s.folder), ...panes().map((p) => p.cwd)]
      .filter((d) => d && d !== h))];
    const repos = (await exec("sh", ["-c", FIND, "sh", ...dirs])).stdout.split("\n").filter(Boolean);
    const email = (await exec("git", ["config", "--global", "user.email"])).stdout.trim();
    // French date by hand: the mods' JS engine has no locales
    const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
    const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
    const pad = (n) => String(n).padStart(2, "0");
    const local = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const out = [`# Récap du ${JOURS[today.getDay()]} ${today.getDate()} ${MOIS[today.getMonth()]}`, ""];

    // Today's commits, all branches, without merges
    let first = null, last = null, total = 0;
    const commits = [];
    for (const repo of repos) {
      // --since filters on commit date: a rebase today would bring back old commits.
      // Keep those written today (author date), one copy per subject (cherry-pick, rebase).
      const r = await exec("git", ["log", "--all", "--no-merges", "--since=midnight", `--author=${email}`, "--format=%h|%ad|%s", "--date=format:%Y-%m-%d %H:%M"], { cwd: repo });
      const seen = new Set();
      const lines = r.stdout.split("\n").filter(Boolean).map((l) => l.split("|"))
        .filter(([, at]) => at.startsWith(local)).map(([h, at, ...subj]) => [h, at.slice(11), subj.join("|")])
        .filter(([, , subj]) => !seen.has(subj) && seen.add(subj))
        .sort((a, b) => a[1].localeCompare(b[1]));
      if (!lines.length) continue;
      total += lines.length;
      for (const [, at] of lines) { first = !first || at < first ? at : first; last = !last || at > last ? at : last; }
      commits.push(`### ${repo.split("/").pop()} · ${lines.length}`, ...lines.map(([hash, at, subj]) => `- \`${at}\` ${subj} \`${hash}\``), "");
    }
    out.push(`## Commits · ${total}${first ? ` · de ${first} à ${last}` : ""}`, "", ...(commits.length ? commits : ["_Aucun commit aujourd'hui._", ""]));

    // MRs created by me and updated today
    const gl = await exec("glab", ["api", `merge_requests?scope=created_by_me&updated_after=${day}T00:00:00Z&per_page=50&state=all`], { cwd: repos[0] ?? h });
    let mrs = [];
    try { mrs = JSON.parse(gl.stdout); } catch { /* glab unavailable */ }
    const state = { opened: "ouverte", merged: "fusionnée", closed: "fermée" };
    out.push(`## MR · ${mrs.length}`, "", ...(mrs.length
      ? mrs.map((m) => `- **${(m.references?.full ?? "").split("/").pop()}** ${m.title} · ${state[m.state] ?? m.state} · [ouvrir](${m.web_url})`)
      : ["_Aucune MR touchée aujourd'hui._"]), "");

    // Claude cost per session (written by the status line)
    const c = await exec(`${h}/.local/bin/hk-agents`, ["--session-costs"]);
    let costs = {};
    try { costs = JSON.parse(c.stdout); } catch { /* nothing */ }
    const rows = Object.entries(costs).sort((a, b) => b[1] - a[1]);
    const sum = rows.reduce((n, [, v]) => n + v, 0);
    out.push(`## Claude · $${sum.toFixed(2)}`, "", ...(rows.length ? rows.map(([k, v]) => `- ${k} · $${v.toFixed(2)}`) : ["_Pas de session aujourd'hui._"]));
    return out.join("\n");
  }

  render() {
    const t = theme(), p = props();
    const btn = (id, label, fn) => div().id(id).px(10).py(3).rounded(5).text_size(11.5).border(1).border_color(t.border)
      .text_color(t.foreground).hover((s) => s.bg(t.hover)).child(label).on_click(fn);
    return v_flex().id("root").size_full().bg(t.background).rounded(10)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().text_size(13).font_semibold().text_color(t.foreground).child("Récap du jour"))
        .child(btn("copy", this.copied ? "Copié ✓" : "Copier", (_e, cx) => cx.spawn(async (cx) => {
          await exec("sh", ["-c", 'printf "%s" "$1" | pbcopy', "sh", this.md]);
          this.copied = true;
          cx.notify();
        })))
        .child(btn("close", "Esc", () => closeOverlay(p.overlay))))
      .child(div().id("body").flex_1().p(18).overflow_y_scrollbar().child(TextView.markdown("recap", this.md).selectable(true)));
  }
}
