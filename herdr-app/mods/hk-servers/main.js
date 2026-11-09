// Space's local servers (portless routes), port state, launching `pnpm dev`.
import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, home, openOverlay, readTextFile, run, setShared, shared, theme } from "herdr";

// Runs an npm script with the repo's package manager (lockfile), pnpm/yarn/bun/npm
const pmArgv = (script) => ["sh", "-c",
  'if [ -f pnpm-lock.yaml ]; then exec pnpm "$0"; elif [ -f yarn.lock ]; then exec yarn "$0"; ' +
  'elif [ -f bun.lockb ] || [ -f bun.lock ]; then exec bun run "$0"; else exec npm run "$0"; fi', script];

// Keyword of a folder: 1st segment of its name (my-app-v2 -> my, shop -> shop)
const keyword = (d) => d.split("/").pop().split("-")[0].toLowerCase();

export default class HkServers extends View {
  init(_p, cx) {
    this.routes = [];
    this.containers = [];
    this.devRepo = null;
    // portless (Node) + nc per route: 15 s is enough for an indicator
    cx.timer.every(15000, (cx) => this.load(cx));
    // Space change: show the space's cache right away, then reload
    cx.timer.every(250, (cx) => {
      const key = this.key();
      if (key === this.shown) return;
      this.shown = key;
      const c = (shared("hk.cache.servers") ?? {})[key];
      this.routes = c?.routes ?? [];
      this.containers = c?.containers ?? [];
      this.devRepo = c?.devRepo ?? null;
      this.load(cx);
    });
  }

  words() {
    return [...new Set((shared("hk.space.dirs") ?? []).map(keyword).filter((w) => w.length >= 3))];
  }

  key() {
    return this.words().sort().join(",");
  }

  load(cx) {
    const words = this.words();
    const key = this.key();
    const repos = shared("hk.space.repos") ?? [];
    this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await exec(`${home()}/.local/bin/hk-servers`, words);
      try { this.routes = JSON.parse(r.stdout || "[]"); } catch { this.routes = []; }
      if (key === this.key()) setShared("hk.servers", this.routes); // for the ⌘K palette
      // Space's Docker containers: compose project whose name contains a keyword of the space
      const dk = await exec("docker", ["ps", "-a", "--format", "{{.Names}}|{{.State}}|{{.Label \"com.docker.compose.project\"}}|{{.Status}}"]);
      this.containers = dk.code ? [] : dk.stdout.split("\n").filter(Boolean).map((l) => {
        const [name, state, project, status] = l.split("|");
        return { name, state, project, status };
      }).filter((c) => c.project && words.some((w) => c.project.toLowerCase().includes(w)));
      // First repo of the space with a `dev` script
      this.devRepo = null;
      for (const repo of repos) {
        try {
          const pkg = JSON.parse(await readTextFile(`${repo}/package.json`));
          if (pkg.scripts?.dev) { this.devRepo = repo; break; }
        } catch { /* no package.json */ }
      }
      this.loading = false;
      if (key !== this.key()) return; // space changed during loading: keep the new one's display
      const all = shared("hk.cache.servers") ?? {};
      setShared("hk.cache.servers", { ...all, [key]: { routes: this.routes, containers: this.containers, devRepo: this.devRepo } });
      cx.notify();
    });
  }

  chip(t, r, i) {
    const name = r.url.replace(/^https?:\/\//, "").replace(/\.localhost.*$/, "");
    return h_flex().id(`srv-${i}`).flex_none().gap(5).items_center().px(6).py(2).rounded(4)
      .hover((s) => s.bg(t.hover)).tooltip(`${r.url} → :${r.port}`)
      .on_click(() => (r.up ? exec("open", [r.url]) : this.down(r)))
      .child(div().w(6).h(6).rounded(3).bg(r.up ? (t.ansi2 ?? t.done) : t.blocked))
      .child(div().text_size(11.5).text_color(r.up ? t.muted : t.dim).child(name));
  }

  // Container: state pill; click = start / restart / stop menu
  box(t, c, i) {
    const up = c.state === "running";
    const short = c.name.replace(`${c.project}-`, "").replace(/-\d+$/, "");
    return h_flex().id(`dk-${i}`).flex_none().gap(5).items_center().px(6).py(2).rounded(4)
      .hover((s) => s.bg(t.hover)).tooltip(`${c.name} · ${c.status}`)
      .on_click(() => this.boxMenu(c, short))
      .child(div().w(6).h(6).rounded(1).bg(up ? (t.ansi2 ?? t.done) : t.dim))
      .child(div().text_size(11.5).text_color(up ? t.muted : t.dim).child(short));
  }

  boxMenu(c, short) {
    const up = c.state === "running";
    const cmd = (verb) => ({ run: "terminal.open", args: { argv: ["docker", verb, c.name], place: "tab", name: `docker ${verb}` } });
    const items = up
      ? [{ icon: "↻", tone: "working", label: "Redémarrer", sub: c.name, ...cmd("restart") },
         { icon: "■", tone: "blocked", label: "Arrêter", sub: c.name, ...cmd("stop") },
         { icon: "≡", tone: "dim", label: "Logs", sub: "docker logs -f", run: "terminal.open", args: { argv: ["docker", "logs", "-f", "--tail", "200", c.name], place: "tab", name: `logs ${short}` } }]
      : [{ icon: "▶", tone: "done", label: "Démarrer", sub: c.name, ...cmd("start") },
         { icon: "≡", tone: "dim", label: "Logs", sub: "docker logs", run: "terminal.open", args: { argv: ["docker", "logs", "--tail", "200", c.name], place: "tab", name: `logs ${short}` } }];
    openOverlay({ mod: "hk-list", kind: "popup", width: 300, height: 44 + items.length * 46, props: { title: `${short} · ${c.status}`, items } });
  }

  // Server not responding: restart the repo's dev, or open anyway
  down(r) {
    const items = [];
    if (this.devRepo) items.push({ icon: "▶", tone: "done", label: `Relancer dev`, sub: this.devRepo.split("/").pop(),
      run: "terminal.open", args: { argv: pmArgv("dev"), folder: this.devRepo, place: "tab", name: "dev" } });
    items.push({ icon: "↗", tone: "dim", label: "Ouvrir quand même", sub: r.url, open: r.url });
    openOverlay({ mod: "hk-list", kind: "popup", width: 320, height: 44 + items.length * 46,
                  props: { title: `${r.url.replace(/^https?:\/\//, "")} ne répond pas`, items } });
  }

  render() {
    const t = theme();
    if (this.px !== 36) { this.px = 36; run("layout.resize", { id: "servers", px: 36 }); }
    const up = this.routes.filter((r) => r.up).length;
    return h_flex().id("root").size_full().px(12).gap(8).items_center().bg(t.chrome)
      .child(div().flex_none().text_size(12.5).font_semibold().text_color(t.foreground).child("Servers"))
      .when(!!this.loading, (e) => e.child(svg("mods/workspace-chrome/spinner.svg").size(11).flex_none().text_color(t.dim).spin(900)))
      .when(!this.routes.length && !(this.containers ?? []).length, (e) => e.child(div().text_size(11.5).text_color(t.dim).child("none")))
      .when(this.routes.length > 0 && up < this.routes.length, (e) =>
        e.child(div().flex_none().text_size(11.5).text_color(t.blocked).child(`${this.routes.length - up} down`)))
      .child(h_flex().id("chips").flex_1().min_w(0).gap(2).overflow_x_scroll()
        .children(this.routes.map((r, i) => this.chip(t, r, i)))
        .when((this.containers ?? []).length > 0, (e) => e.child(div().w(1).h(14).mx(4).flex_none().bg(t.border)))
        .children((this.containers ?? []).map((c, i) => this.box(t, c, i))))
      .when(!!this.devRepo, (e) => e.child(
        div().id("dev").flex_none().w(26).h(24).rounded(5).flex().items_center().justify_center()
          .text_size(12).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .tooltip(`dev · ${this.devRepo.split("/").pop()}`).child("▶")
          .on_click(() => run("terminal.open", { argv: pmArgv("dev"), folder: this.devRepo, place: "tab", name: "dev" }))));
  }
}
