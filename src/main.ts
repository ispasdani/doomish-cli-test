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

// ---------- THEME ----------
const THEME = {
  bg: "black",
  panel: "black",
  fg: "white",
  dim: "gray",
  neonCyan: "cyan",
  neonMagenta: "magenta",
  neonPurple: "magenta",
  neonGreen: "green",
  danger: "red",
  border: "cyan",
  selectionBg: "magenta",
};

const ASCII_DOOMISH = [
  "██████╗  ██████╗  ██████╗ ███╗   ███╗██╗███████╗██╗  ██╗",
  "██╔══██╗██╔═══██╗██╔═══██╗████╗ ████║██║██╔════╝██║  ██║",
  "██║  ██║██║   ██║██║   ██║██╔████╔██║██║███████╗███████║",
  "██║  ██║██║   ██║██║   ██║██║╚██╔╝██║██║╚════██║██╔══██║",
  "██████╔╝╚██████╔╝╚██████╔╝██║ ╚═╝ ██║██║███████║██║  ██║",
  "╚═════╝  ╚═════╝  ╚═════╝ ╚═╝     ╚═╝╚═╝╚══════╝╚═╝  ╚═╝",
  "              cyberpunk modal editor • doom-ish vibes",
].join("\n");

function modeLabel(mode: Mode) {
  switch (mode) {
    case "NORMAL":
      return "NORMAL";
    case "INSERT":
      return "INSERT";
    case "VISUAL":
      return "VISUAL";
    case "COMMAND":
      return "COMMAND";
    case "LEADER":
      return "LEADER";
  }
}

function modeColor(mode: Mode) {
  switch (mode) {
    case "NORMAL":
      return THEME.neonCyan;
    case "INSERT":
      return THEME.neonGreen;
    case "VISUAL":
      return THEME.neonMagenta;
    case "COMMAND":
      return THEME.neonPurple;
    case "LEADER":
      return THEME.neonMagenta;
  }
}

// ---------- SCREEN ----------
const screen = blessed.screen({
  smartCSR: true,
  title: "DOOMISH",
  fullUnicode: true,
  dockBorders: true,
});

screen.key(["C-c"], () => process.exit(0));

// Root container
const root = blessed.box({
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
  style: { bg: THEME.bg, fg: THEME.fg },
});
screen.append(root);

// Top bar (cyberpunk HUD)
const topBar = blessed.box({
  top: 0,
  left: 0,
  width: "100%",
  height: 1,
  tags: true,
  style: { bg: THEME.panel, fg: THEME.fg },
});
root.append(topBar);

// Editor area
const gutterWidth = 6;
const editorBox = blessed.box({
  top: 1,
  left: 0,
  width: "100%",
  height: "100%-3",
  tags: false,
  style: { bg: THEME.bg, fg: THEME.fg },
});
root.append(editorBox);

// Bottom bar
const bottomBar = blessed.box({
  bottom: 0,
  left: 0,
  width: "100%",
  height: 2,
  tags: true,
  style: { bg: THEME.panel, fg: THEME.fg },
});
root.append(bottomBar);

// Leader hints overlay (which-key)
const hintsBox = blessed.box({
  top: 2,
  left: 2,
  width: "60%",
  height: 12,
  border: "line",
  tags: true,
  hidden: true,
  style: {
    bg: THEME.panel,
    fg: THEME.fg,
    border: { fg: THEME.border },
  },
  label: ` {${THEME.neonMagenta}-fg}DOOMISH{/} {${THEME.dim}-fg}which-key{/} `,
});
root.append(hintsBox);

// Splash overlay
const splash = blessed.box({
  top: "center",
  left: "center",
  width: "90%",
  height: 9,
  tags: true,
  border: "line",
  hidden: true,
  style: {
    bg: THEME.panel,
    fg: THEME.neonCyan,
    border: { fg: THEME.neonMagenta },
  },
});
root.append(splash);

// Command palette overlay
const paletteBox = blessed.box({
  top: "center",
  left: "center",
  width: "72%",
  height: "65%",
  border: "line",
  hidden: true,
  tags: true,
  style: {
    bg: THEME.panel,
    fg: THEME.fg,
    border: { fg: THEME.neonCyan },
  },
  label: ` {${THEME.neonCyan}-fg}palette{/} `,
});
const paletteInput = blessed.textbox({
  top: 0,
  left: 1,
  width: "100%-2",
  height: 1,
  inputOnFocus: true,
  style: { bg: THEME.bg, fg: THEME.neonCyan },
});
const paletteList = blessed.list({
  top: 2,
  left: 1,
  width: "100%-2",
  height: "100%-3",
  keys: true,
  mouse: false,
  style: {
    bg: THEME.panel,
    fg: THEME.fg,
    selected: { bg: THEME.selectionBg, fg: THEME.fg },
    item: { bg: THEME.panel, fg: THEME.fg },
  },
});
paletteBox.append(paletteInput);
paletteBox.append(paletteList);
root.append(paletteBox);

// ---------- DATA ----------
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
    title: "Find file (open path)",
    run: () => {
      openPalette("Open file: ");
    },
  },
  "file.save": {
    id: "file.save",
    title: "Save file",
    run: () => {
      if (!state.filePath) {
        state.statusMessage = "No file path. Use SPC f f and type one.";
        return;
      }
      buf.saveToFile(state.filePath);
      state.statusMessage = "Saved.";
    },
  },
  "buffer.list": {
    id: "buffer.list",
    title: "List buffers (MVP)",
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

// ---------- HELPERS ----------
function clampCursor() {
  const row = Math.max(0, Math.min(state.cursor.row, buf.lineCount() - 1));
  const line = buf.lineAt(row);
  const col = Math.max(0, Math.min(state.cursor.col, line.length));
  state.cursor.row = row;
  state.cursor.col = col;
}

function ensureCursorVisible() {
  const height = (screen.height as number) - 3; // top bar + bottom 2
  if (state.cursor.row < state.scrollTop) state.scrollTop = state.cursor.row;
  if (state.cursor.row >= state.scrollTop + height)
    state.scrollTop = state.cursor.row - height + 1;
  if (state.scrollTop < 0) state.scrollTop = 0;
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
  const key = k === "space" ? " " : k;

  const next = stepLeader(leaderNode, key);
  if (!next) {
    state.statusMessage = `No binding: ${["SPC", ...state.leader.seq, key].join(" ")}`;
    cancelLeader();
    return;
  }

  state.leader.seq.push(key);

  if (next.kind === "cmd") {
    cancelLeader();
    commands[next.commandId].run();
    return;
  }

  leaderNode = next;
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
  const cmdItems = Object.values(commands);
  const hits = fuzzyFind(query, cmdItems, (c) => c.title, 30);
  const items = hits.map((h) => h.item.title);

  const q = query.trim();
  if (q && /[./\\]/.test(q)) {
    items.unshift(`Open file path: ${q}`);
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

// ---------- RENDER ----------
function renderTopBar() {
  const file = state.filePath ? path.basename(state.filePath) : "untitled";
  const proj = state.projectRoot ? path.basename(state.projectRoot) : "-";
  const dirty = buf.dirty ? `{${THEME.neonMagenta}-fg}*{/}` : "";
  const right = `{${THEME.dim}-fg}proj{/}:${proj}  {${THEME.dim}-fg}file{/}:${file}${dirty}`;

  // left “DOOMISH” logo chunk
  const left = `{${THEME.neonMagenta}-fg} DOOMISH {/} {${THEME.dim}-fg}:: cyberpunk modal editor{/}`;

  // pad / align
  const w = screen.width as number;
  const rawLeft = " DOOMISH :: cyberpunk modal editor";
  const rawRight = `proj:${proj}  file:${file}${buf.dirty ? "*" : ""}`;
  const space = Math.max(1, w - rawLeft.length - rawRight.length - 2);
  topBar.setContent(`${left}${" ".repeat(space)}${right}`);
}

function renderBottomBar() {
  const mode = modeLabel(state.mode);
  const mc = modeColor(state.mode);

  const pos = `${state.cursor.row + 1}:${state.cursor.col + 1}`;
  const msg = state.statusMessage
    ? ` {${THEME.dim}-fg}—{/} ${state.statusMessage}`
    : "";

  const pill = `{black-fg}{${mc}-bg} ${mode} {/}`;
  const hint = `{${THEME.dim}-fg}  SPC{/} leader  {${THEME.dim}-fg}i{/} insert  {${THEME.dim}-fg}:{/} palette  {${THEME.dim}-fg}Esc{/} back`;

  bottomBar.setContent(
    `${pill}  {${THEME.dim}-fg}pos{/}:${pos}${msg}\n${hint}`,
  );
}

function renderEditor() {
  const width = screen.width as number;
  const height = (screen.height as number) - 3;

  const out: string[] = [];
  for (let i = 0; i < height; i++) {
    const row = state.scrollTop + i;
    if (row >= buf.lineCount()) {
      out.push(`{${THEME.dim}-fg}~{/}`);
      continue;
    }

    const line = buf.lineAt(row);
    const rel =
      row === state.cursor.row ? row + 1 : Math.abs(row - state.cursor.row);

    const gutterNum = String(rel).padStart(gutterWidth - 1, " ") + " ";
    const gutter =
      row === state.cursor.row
        ? `{${THEME.neonCyan}-fg}${gutterNum}{/}`
        : `{${THEME.dim}-fg}${gutterNum}{/}`;

    const maxLen = Math.max(0, width - gutterWidth - 1);
    const shown = line.length > maxLen ? line.slice(0, maxLen) : line;

    out.push(gutter + shown);
  }

  editorBox.setContent(out.join("\n"));

  // Terminal cursor
  const cursorY = state.cursor.row - state.scrollTop + 1; // +1 top bar
  const cursorX = gutterWidth + state.cursor.col;
  try {
    (screen as any).program.cup(cursorY, Math.max(0, cursorX));
    (screen as any).program.showCursor();
  } catch {}
}

function renderLeaderHints() {
  if (state.mode !== "LEADER") {
    hintsBox.hide();
    return;
  }

  const hints = getHints(leaderNode);
  const seq = ["SPC", ...state.leader.seq].join(" ");
  const header = `{${THEME.neonMagenta}-fg}${seq}{/}  {${THEME.dim}-fg}(press Esc to cancel){/}`;

  const lines = hints.map((h) => {
    const k = `{${THEME.neonCyan}-fg}${h.key.padEnd(3)}{/}`;
    const marker =
      h.kind === "group"
        ? `{${THEME.neonMagenta}-fg}▸{/}`
        : `{${THEME.neonGreen}-fg}•{/}`;
    return `${k} ${marker} ${h.title}`;
  });

  hintsBox.setContent([header, "", ...lines].join("\n"));
  hintsBox.show();
}

function render() {
  renderTopBar();
  renderEditor();
  renderLeaderHints();
  renderBottomBar();
  screen.render();
}

// ---------- INPUT ----------
function normalModeKey(name: string, ch?: string) {
  if (name === "space") return startLeader();
  if (name === "i") return setMode("INSERT");
  if (name === "v") return setMode("VISUAL");
  if (name === ":") return openPalette("");

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

  if (ch && ch.length === 1) {
    buf.insertChar(state.cursor.row, state.cursor.col, ch);
    state.cursor.col += 1;
    ensureCursorVisible();
  }
}

screen.on("keypress", (_ch: string, key: { name: string }) => {
  const name = key?.name ?? "";
  const ch = _ch ?? "";

  // Palette mode
  if (state.commandPaletteOpen) {
    if (name === "escape") {
      closePalette();
      render();
      return;
    }

    if (name.length === 1 || name === "backspace" || name === "delete") {
      setTimeout(() => {
        const v = paletteInput.getValue();
        const q = v.replace(/^Open file:\s*/, "");
        refreshPaletteList(q);
        screen.render();
      }, 0);
      return;
    }

    if (name === "enter") {
      const selected =
        paletteList.getItem(paletteList.selected)?.getText() ?? "";
      const v = paletteInput.getValue().trim();

      if (selected.startsWith("Open file path:")) {
        const p = selected.replace(/^Open file path:\s*/, "").trim();
        closePalette();
        openFile(path.resolve(p));
        render();
        return;
      }

      if (v.startsWith("Open file:")) {
        const p = v.replace(/^Open file:\s*/, "").trim();
        closePalette();
        openFile(path.resolve(p));
        render();
        return;
      }

      const cmd = Object.values(commands).find((c) => c.title === selected);
      closePalette();
      cmd?.run();
      render();
      return;
    }

    return;
  }

  // Leader
  if (state.mode === "LEADER") {
    if (name === "escape") {
      cancelLeader();
      render();
      return;
    }
    handleLeaderKey(name);
    render();
    return;
  }

  if (state.mode === "NORMAL") normalModeKey(name, ch);
  else if (state.mode === "INSERT") insertModeKey(name, ch);
  else if (state.mode === "VISUAL") {
    if (name === "escape") setMode("NORMAL");
    else normalModeKey(name, ch);
  }

  render();
});

// ---------- BOOT ----------
function showSplash() {
  splash.setContent(`{${THEME.neonCyan}-fg}${ASCII_DOOMISH}{/}`);
  splash.show();
  screen.render();
  setTimeout(() => {
    splash.hide();
    render();
  }, 700);
}

const maybePath = process.argv[2];
if (maybePath) {
  const p = path.resolve(maybePath);
  if (fs.existsSync(p)) openFile(p);
  else state.statusMessage = "File not found: " + p;
} else {
  state.statusMessage = "SPC f f to open a file";
}

editorBox.focus();
showSplash();
render();
