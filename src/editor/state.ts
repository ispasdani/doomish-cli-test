export type Mode = "NORMAL" | "INSERT" | "VISUAL" | "COMMAND" | "LEADER";

export type Cursor = { row: number; col: number };

export type LeaderState = {
  active: boolean;
  startedAt: number;
  seq: string[]; // e.g. ["f","f"]
};

export type EditorState = {
  mode: Mode;
  filePath: string | null;
  projectRoot: string | null;

  cursor: Cursor;
  scrollTop: number;

  leader: LeaderState;

  // Command line / palette
  commandLine: string;
  commandPaletteOpen: boolean;
  paletteQuery: string;

  statusMessage: string;
};
