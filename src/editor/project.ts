import fs from "node:fs";
import path from "node:path";

export function findProjectRoot(startPath: string): string | null {
  let cur = path.resolve(startPath);
  while (true) {
    const gitDir = path.join(cur, ".git");
    if (fs.existsSync(gitDir)) return cur;

    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}
