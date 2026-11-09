// Modal: modified files of a repo (left) and colored diff of the chosen file (right).
// props: { repo, label, overlay, commit?, subject? } ; with commit: files and diff of that commit (first parent). Up/down change file, Esc closes.
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { closeOverlay, exec, props as rawProps, shared, theme } from "herdr";

// Without repo (opened by mod.open or the palette): the space's first repo
const props = () => {
  const p = rawProps() ?? {};
  const repo = p.repo ?? (shared("hk.space.repos") ?? [])[0];
  return { ...p, repo, label: p.label ?? repo?.split("/").pop() };
};
// Commit: diff against the first parent (merges included), root commit against the empty tree
const TREE = ["diff-tree", "-r", "--root", "-m", "--first-parent", "--no-commit-id"];
const MAX_LINES = 1500; // ponytail: beyond this, the diff is cut (a huge generated file would freeze the modal)
// Porcelain code -> label and color
const KIND = { M: ["modifié", "working"], A: ["ajouté", "done"], D: ["supprimé", "blocked"], R: ["renommé", "accent"], "?": ["nouveau", "done"] };

export default class HkDiff extends View {
  init(_p, cx) {
    this.files = [];
    this.at = 0;
    this.lines = [];
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async (cx) => {
      const { repo, commit } = props();
      if (commit) {
        const r = await exec("git", [...TREE, "--name-status", commit], { cwd: repo });
        this.files = r.stdout.split("\n").filter(Boolean).map((l) => {
          const [code, ...paths] = l.split("\t");
          return { code: code[0], path: paths.pop() };
        });
        return this.load(cx);
      }
      const r = await exec("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repo });
      this.files = r.stdout.split("\n").filter(Boolean).map((l) => {
        const code = l.slice(0, 2).trim()[0] ?? "M";
        const path = l.slice(3).split(" -> ").pop();
        return { code, path };
      });
      this.load(cx);
    });
  }

  load(cx) {
    const f = this.files[this.at];
    if (!f) { cx.notify(); return; }
    const repo = props().repo;
    cx.spawn(async (cx) => {
      // New untracked file: diff against /dev/null; otherwise working + staged diff against HEAD
      const commit = props().commit;
      const r = commit ? await exec("git", [...TREE, "-p", "--no-color", commit, "--", f.path], { cwd: repo })
        : f.code === "?"
        ? await exec("git", ["diff", "--no-index", "--no-color", "--", "/dev/null", f.path], { cwd: repo })
        : await exec("git", ["diff", "HEAD", "--no-color", "--", f.path], { cwd: repo });
      const all = r.stdout.split("\n");
      const start = all.findIndex((l) => l.startsWith("@@"));
      this.lines = (start >= 0 ? all.slice(start) : all).slice(0, MAX_LINES);
      this.cut = all.length > MAX_LINES;
      cx.notify();
    });
  }

  pick(cx, i) {
    if (i < 0 || i >= this.files.length || i === this.at) return;
    this.at = i;
    this.lines = [];
    this.load(cx);
  }

  line(t, l, i) {
    const c = l[0];
    const add = t.ansi2 ?? t.done;
    const [fg, bg] = c === "+" ? [add, add + "1a"] : c === "-" ? [t.blocked, t.blocked + "1a"]
      : l.startsWith("@@") ? [t.accent, t.accent + "12"] : [t.muted, null];
    let el = div().id(`l${i}`).px(12).min_h(18).text_size(12).text_color(fg).child(l.length ? l : " ");
    if (bg) el = el.bg(bg);
    return el;
  }

  render(cx) {
    const t = theme(), p = props();
    const f = this.files[this.at];
    const list = v_flex().id("files").w(300).flex_none().h_full().overflow_y_scrollbar().p(6).gap(1)
      .border_r(1).border_color(t.border).bg(t.chrome)
      .children(this.files.map((x, i) => {
        const [what, tone] = KIND[x.code] ?? ["modifié", "working"];
        const name = x.path.split("/").pop();
        const dir = x.path.slice(0, -name.length).replace(/\/$/, "");
        return h_flex().id(`f${i}`).px(8).py(4).gap(8).items_center().rounded(5)
          .bg(i === this.at ? t.selected : t.chrome).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => this.pick(cx, i))
          .child(div().w(6).h(6).rounded(3).flex_none().bg(t[tone]).tooltip(what))
          .child(v_flex().flex_1().min_w(0)
            .child(div().truncate().text_size(12.5).text_color(t.foreground).child(name))
            .child(div().truncate().text_size(10.5).text_color(t.dim).child(dir || "/")));
      }));
    const body = v_flex().id("diff").flex_1().min_w(0).h_full().overflow_y_scrollbar().py(6).bg(t.background)
      .font_family("JetBrains Mono")
      .children(this.lines.map((l, i) => this.line(t, l, i)))
      .when(this.cut, (e) => e.child(div().px(12).py(6).text_size(11).text_color(t.dim).child(`… diff coupé à ${MAX_LINES} lignes`)))
      .when(!this.files.length, (e) => e.child(div().p(16).text_size(12).text_color(t.dim).child("Aucun fichier modifié")));
    return v_flex().id("root").size_full().bg(t.background).rounded(10).track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape") return closeOverlay(p.overlay);
        if (e.key === "down") this.pick(cx, this.at + 1);
        else if (e.key === "up") this.pick(cx, this.at - 1);
        else return;
        cx.stop_propagation();
      })
      .child(h_flex().h(40).flex_none().px(14).gap(10).items_center().border_b(1).border_color(t.border)
        .child(div().text_size(13).font_semibold().text_color(t.foreground).child(p.label ?? "Changements"))
        .child(div().text_size(11.5).text_color(t.dim).child(`${this.files.length} fichier(s)`))
        .when(Boolean(p.subject), (e) => e.child(div().max_w(420).truncate().text_size(11.5).text_color(t.foreground).child(p.subject)))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(f?.path ?? ""))
        .child(div().text_size(11).text_color(t.dim).child("↑↓  Esc")))
      .child(h_flex().flex_1().min_h(0).child(list).child(body));
  }
}
