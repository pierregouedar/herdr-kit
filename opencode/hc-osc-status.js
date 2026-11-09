// opencode status for Herdr Desktop: OSC 7501 written to the terminal (the official plugin
// herdr-agent-state.js only targets the herdr TUI, which provides HERDR_PANE_ID).
// ponytail: sub-sessions ignored, only the root session drives the pane status.
import { openSync, writeSync } from "node:fs";

let tty = null;
const children = new Set();
let last = "";

function report(state, kind) {
  const rec = `state=${state}${kind ? `:kind=${kind}` : ""}:app=opencode`;
  if (rec === last) return;
  last = rec;
  try {
    tty ??= openSync("/dev/tty", "w");
    writeSync(tty, `\x1b]7501;${rec}\x07`);
  } catch { /* no terminal: nothing to report */ }
}

export const HcOscStatus = async () => {
  if (!process.env.HC_TERMINAL_SOCKET) return {};
  report("idle");
  return {
    event: async ({ event }) => {
      const p = event.properties ?? {};
      if (event.type === "session.created" && p.info?.parentID) children.add(p.info.id);
      const sid = p.sessionID ?? p.info?.id;
      if (sid && children.has(sid) && !event.type.startsWith("permission.") && !event.type.startsWith("question.")) return;
      switch (event.type) {
        case "session.status": {
          const t = p.status?.type;
          report(t === "idle" ? "idle" : "working");
          break;
        }
        case "session.idle":
        case "session.error":
          report("idle");
          break;
        case "permission.asked":
          report("blocked", "permission");
          break;
        case "question.asked":
          report("blocked", "question");
          break;
        case "permission.replied":
        case "question.replied":
        case "question.rejected":
          report("working");
          break;
      }
    },
  };
};
