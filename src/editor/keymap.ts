export type CommandId =
  | "file.open"
  | "file.save"
  | "buffer.list"
  | "palette.open"
  | "quit";

export type Command = {
  id: CommandId;
  title: string;
  run: () => void;
};

export type KeyNode =
  | { kind: "group"; title: string; children: Record<string, KeyNode> }
  | { kind: "cmd"; title: string; commandId: CommandId };

export function group(
  title: string,
  children: Record<string, KeyNode>,
): KeyNode {
  return { kind: "group", title, children };
}
export function cmd(title: string, commandId: CommandId): KeyNode {
  return { kind: "cmd", title, commandId };
}

// Doom-ish leader map: SPC ...
export const leaderMap: KeyNode = group("leader", {
  f: group("files", {
    f: cmd("Find file (open)", "file.open"),
    s: cmd("Save file", "file.save"),
  }),
  b: group("buffers", {
    b: cmd("List buffers", "buffer.list"),
  }),
  " ": cmd("Command palette", "palette.open"),
  q: cmd("Quit", "quit"),
});

export function getHints(
  node: KeyNode,
): Array<{ key: string; title: string; kind: "group" | "cmd" }> {
  if (node.kind !== "group") return [];
  return Object.entries(node.children).map(([key, child]) => ({
    key,
    title: child.title,
    kind: child.kind,
  }));
}

export function stepLeader(node: KeyNode, key: string): KeyNode | null {
  if (node.kind !== "group") return null;
  return node.children[key] ?? null;
}
