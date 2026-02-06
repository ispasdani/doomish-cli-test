import fs from "node:fs";

export class TextBuffer {
  lines: string[] = [""];
  dirty = false;

  loadFromFile(path: string) {
    const data = fs.readFileSync(path, "utf8");
    // Keep trailing newline behavior simple for now:
    this.lines = data.replace(/\r\n/g, "\n").split("\n");
    if (this.lines.length === 0) this.lines = [""];
    this.dirty = false;
  }

  saveToFile(path: string) {
    fs.writeFileSync(path, this.lines.join("\n"), "utf8");
    this.dirty = false;
  }

  insertChar(row: number, col: number, ch: string) {
    const line = this.lines[row] ?? "";
    this.lines[row] = line.slice(0, col) + ch + line.slice(col);
    this.dirty = true;
  }

  deleteCharBackward(row: number, col: number): { row: number; col: number } {
    if (row < 0) return { row: 0, col: 0 };
    const line = this.lines[row] ?? "";

    // If at start of line, join with previous
    if (col === 0) {
      if (row === 0) return { row, col };
      const prev = this.lines[row - 1] ?? "";
      this.lines[row - 1] = prev + line;
      this.lines.splice(row, 1);
      this.dirty = true;
      return { row: row - 1, col: prev.length };
    }

    this.lines[row] = line.slice(0, col - 1) + line.slice(col);
    this.dirty = true;
    return { row, col: col - 1 };
  }

  insertNewline(row: number, col: number): { row: number; col: number } {
    const line = this.lines[row] ?? "";
    const before = line.slice(0, col);
    const after = line.slice(col);
    this.lines[row] = before;
    this.lines.splice(row + 1, 0, after);
    this.dirty = true;
    return { row: row + 1, col: 0 };
  }

  lineCount() {
    return this.lines.length;
  }

  lineAt(row: number) {
    return this.lines[row] ?? "";
  }
}
