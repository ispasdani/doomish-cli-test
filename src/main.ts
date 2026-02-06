import blessed from "neo-blessed";
import path from "node:path";
import fs from "node:fs";

import { TextBuffer } from "./editor/buffer.js";
import type { EditorState, Mode } from "./editor/state.js";
import { findProjectRoot } from "./editor/project.js";
import {
  leaderMap,
  stepLeader,
  getHints,
  type Command,
  type CommandId,
  type KeyNode,
} from "./editor/keymap.js";
import { fuzzyFind } from "./editor/fuzzy.js";

const screen = blessed.screen({
  smartCSR: true,
  title: "doomish",
  fullUnicode: true,
});

screen.key(["C-c"], () => process.exit(0));

const root = blessed.box({ top: 0, left: 0, width: "100%", height: "100%" });
screen.append(root);

// Main editor view
const gutterWidth = 6;
const editorBox = blessed.box({
  top: 0,
  left: 0,
  width: "100%",
  height: "100%-1",
  tags: false,
});
root.append(editorBox);

const status = blessed.box({
  bottom: 0,
  left: 0,
  width: "100%",
  height: 1,
});
root.append(status);

// Leader hints overlay
const hintsBox = blessed.box({
  top: 1,
  left: 2,
  width: "50%",
  height: 10,
  border: "line",
  hidden: true,
});
root.append(hintsBox);

// Command palette overlay
const paletteBox = blessed.box({
  top: "center",
  left: "center",
  width: "70%",
  height: "60%",
  border: "line",
  hidden: true,
});
const paletteInput = blessed.textbox({
  top: 0,
  left: 1,
  width: "100%-2",
  height: 1,
  inputOnFocus: true,
});
const paletteList = blessed.list({
  top: 2,
  left: 1,
  width: "100%-2",
  height: "100%-3",
  keys: true,
  mouse: false,
  style: { selected: { inverse: true } },
});
paletteBox.append(paletteInput);
paletteBox.append(paletteList);
root.append(paletteBox);

const buf = new TextBuffer();

const state: EditorState = {
  mode: "NORMAL",
  filePath: null,
  projectRoot: null,
  cursor: { row: 0, col: 0 },
  scrollTop: 0,
  leader: { active: false, startedAt: 0, seq: [] },
  commandLine: "",
  commandPaletteOpen: false,
  paletteQuery: "",
  statusMessage: "",
};

let leaderNode: KeyNode = leaderMap;

const commands: Record<CommandId, Command> = {
  "file.open": {
    id: "file.open",
    title: "Find file (open)",
    run: () => {
      // Minimal: ask for a path via palette-like prompt
      openPalette("Open file: ");
      // When user confirms selection, we’ll treat it as a path (MVP)
    },
  },
  "file.save": {
    id: "file.save",
    title: "Save file",
    run: () => {
      if (!state.filePath) {
        state.statusMessage = "No file path. Use SPC f f and type a path.";
        return;
      }
      buf.saveToFile(state.filePath);
      state.statusMessage = "Saved.";
    },
  },
  "buffer.list": {
    id: "buffer.list",
    title: "List buffers",
    run: () => {
      state.statusMessage = "MVP: single buffer only (for now).";
    },
  },
  "palette.open": {
    id: "palette.open",
    title: "Command palette",
    run: () => openPalette(""),
  },
  quit: {
    id: "quit",
    title: "Quit",
    run: () => process.exit(0),
  },
};

function clampCursor() {
  const row = Math.max(0, Math.min(state.cursor.row, buf.lineCount() - 1));
  const line = buf.lineAt(row);
  const col = Math.max(0, Math.min(state.cursor.col, line.length));
  state.cursor.row = row;
  state.cursor.col = col;
}

function ensureCursorVisible() {
  const height = (screen.height as number) - 1;
  if (state.cursor.row < state.scrollTop) state.scrollTop = state.cursor.row;
  if (state.cursor.row >= state.scrollTop + height)
    state.scrollTop = state.cursor.row - height + 1;
  if (state.scrollTop < 0) state.scrollTop = 0;
}

function render() {
  const width = screen.width as number;
  const height = (screen.height as number) - 1;

  // Render visible lines
  const out: string[] = [];
  for (let i = 0; i < height; i++) {
    const row = state.scrollTop + i;
    if (row >= buf.lineCount()) {
      out.push("~");
      continue;
    }
    const line = buf.lineAt(row);

    // Relative numbers (like Doom/Vim)
    const rel =
      row === state.cursor.row ? row + 1 : Math.abs(row - state.cursor.row);
    const gutter = String(rel).padStart(gutterWidth - 1, " ") + " ";
    const shown =
      line.length > width - gutterWidth
        ? line.slice(0, width - gutterWidth - 1)
        : line;
    out.push(gutter + shown);
  }
  editorBox.setContent(out.join("\n"));

  // Put terminal cursor roughly at the right spot
  const cursorY = state.cursor.row - state.scrollTop;
  const cursorX = gutterWidth + state.cursor.col;
  // blessed cursor positioning uses program cursor, but we can approximate via screen.program
  try {
    (screen as any).program.cup(cursorY, Math.max(0, cursorX));
    (screen as any).program.showCursor();
  } catch {}

  const mode = state.mode;
  const file = state.filePath ? path.basename(state.filePath) : "[No File]";
  const proj = state.projectRoot ? path.basename(state.projectRoot) : "-";
  const pos = `${state.cursor.row + 1}:${state.cursor.col + 1}`;
  const dirty = buf.dirty ? "*" : "";
  const msg = state.statusMessage ? ` — ${state.statusMessage}` : "";
  status.setContent(` ${mode}  ${file}${dirty}  proj:${proj}  ${pos}${msg}`);

  // Leader hints
  if (state.mode === "LEADER") {
    const hints = getHints(leaderNode);
    const lines = hints.map(
      (h) => `${h.key}  ${h.kind === "group" ? "▸" : "•"} ${h.title}`,
    );
    hintsBox.setContent(lines.join("\n"));
    hintsBox.show();
  } else {
    hintsBox.hide();
  }

  screen.render();
}

function setMode(m: Mode) {
  state.mode = m;
  state.statusMessage = "";
}

function startLeader() {
  state.leader.active = true;
  state.leader.startedAt = Date.now();
  state.leader.seq = [];
  leaderNode = leaderMap;
  setMode("LEADER");
}

function cancelLeader() {
  state.leader.active = false;
  state.leader.seq = [];
  leaderNode = leaderMap;
  setMode("NORMAL");
}

function handleLeaderKey(k: string) {
  // Space leader supports sub-space: treat "space" as " "
  const key = k === "space" ? " " : k;

  const next = stepLeader(leaderNode, key);
  if (!next) {
    state.statusMessage = `No binding for: ${["SPC", ...state.leader.seq, key].join(" ")}`;
    cancelLeader();
    return;
  }

  state.leader.seq.push(key);

  if (next.kind === "cmd") {
    cancelLeader();
    commands[next.commandId].run();
    return;
  }

  leaderNode = next; // group
  // remain in LEADER, showing updated hints
}

function openFile(p: string) {
  if (!fs.existsSync(p)) {
    state.statusMessage = "File not found.";
    return;
  }
  buf.loadFromFile(p);
  state.filePath = p;
  state.projectRoot = findProjectRoot(path.dirname(p));
  state.cursor = { row: 0, col: 0 };
  state.scrollTop = 0;
  state.statusMessage = "Opened.";
}

function openPalette(prefill: string) {
  state.commandPaletteOpen = true;
  paletteBox.show();
  paletteInput.setValue(prefill);
  paletteInput.focus();

  refreshPaletteList("");
  screen.render();
}

function closePalette() {
  state.commandPaletteOpen = false;
  paletteBox.hide();
  editorBox.focus();
}

function refreshPaletteList(query: string) {
  // For now: fuzzy over commands + (if query looks like a path) allow open
  const cmdItems = Object.values(commands);
  const hits = fuzzyFind(query, cmdItems, (c) => c.title, 30);
  const items = hits.map((h) => h.item.title);

  // show a special "open path" action if user typed something with / or .
  if (query.trim() && /[./\\]/.test(query.trim())) {
    items.unshift(`Open file path: ${query.trim()}`);
  }

  paletteList.setItems(items.length ? items : ["(no results)"]);
  paletteList.select(0);
}

function moveCursor(dr: number, dc: number) {
  state.cursor.row += dr;
  state.cursor.col += dc;
  clampCursor();
  ensureCursorVisible();
}

function normalModeKey(name: string, ch?: string) {
  if (name === "space") return startLeader();
  if (name === "i") return setMode("INSERT");
  if (name === "v") return setMode("VISUAL");
  if (name === ":") return openPalette(""); // treat as command palette MVP

  if (name === "h") return moveCursor(0, -1);
  if (name === "l") return moveCursor(0, +1);
  if (name === "j") return moveCursor(+1, 0);
  if (name === "k") return moveCursor(-1, 0);

  if (name === "0") {
    state.cursor.col = 0;
    ensureCursorVisible();
    return;
  }
  if (name === "$") {
    state.cursor.col = buf.lineAt(state.cursor.row).length;
    ensureCursorVisible();
    return;
  }
}

function insertModeKey(name: string, ch?: string) {
  if (name === "escape") return setMode("NORMAL");

  if (name === "backspace") {
    const { row, col } = buf.deleteCharBackward(
      state.cursor.row,
      state.cursor.col,
    );
    state.cursor.row = row;
    state.cursor.col = col;
    ensureCursorVisible();
    return;
  }

  if (name === "enter") {
    const { row, col } = buf.insertNewline(state.cursor.row, state.cursor.col);
    state.cursor.row = row;
    state.cursor.col = col;
    ensureCursorVisible();
    return;
  }

  // printable char
  if (ch && ch.length === 1) {
    buf.insertChar(state.cursor.row, state.cursor.col, ch);
    state.cursor.col += 1;
    ensureCursorVisible();
  }
}

screen.on("keypress", (_ch, key) => {
  const name = key?.name ?? "";
  const ch = _ch ?? "";

  // Palette handling
  if (state.commandPaletteOpen) {
    if (name === "escape") {
      closePalette();
      return render();
    }

    // Update list as user types: blessed textbox emits keypress too
    if (name.length === 1 || name === "backspace" || name === "delete") {
      // Let textbox update value, then read it next tick
      setTimeout(() => {
        const q = paletteInput.getValue();
        refreshPaletteList(q.replace(/^Open file:\s*/, ""));
        screen.render();
      }, 0);
      return;
    }

    if (name === "enter") {
      const selected =
        paletteList.getItem(paletteList.selected)?.getText() ?? "";
      const q = paletteInput.getValue().trim();

      if (selected.startsWith("Open file path:")) {
        const p = selected.replace(/^Open file path:\s*/, "").trim();
        closePalette();
        openFile(path.resolve(p));
        return render();
      }

      // If user typed a path into "Open file:" flow, treat it as a path:
      if (q.startsWith("Open file:")) {
        const p = q.replace(/^Open file:\s*/, "").trim();
        closePalette();
        openFile(path.resolve(p));
        return render();
      }

      // Otherwise run matching command by exact title:
      const cmd = Object.values(commands).find((c) => c.title === selected);
      closePalette();
      cmd?.run();
      return render();
    }

    return; // while palette open, don’t fall through
  }

  // Leader mode
  if (state.mode === "LEADER") {
    if (name === "escape") {
      cancelLeader();
      return render();
    }
    handleLeaderKey(name);
    return render();
  }

  if (state.mode === "NORMAL") normalModeKey(name, ch);
  else if (state.mode === "INSERT") insertModeKey(name, ch);
  else if (state.mode === "VISUAL") {
    // MVP: treat visual as normal for now (we’ll add selection next)
    if (name === "escape") setMode("NORMAL");
    else normalModeKey(name, ch);
  }

  render();
});

// Boot: open file from CLI arg if provided
const maybePath = process.argv[2];
if (maybePath) {
  const p = path.resolve(maybePath);
  if (fs.existsSync(p)) openFile(p);
  else state.statusMessage = "File not found: " + p;
}

editorBox.focus();
render();
