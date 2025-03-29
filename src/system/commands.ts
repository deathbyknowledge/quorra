import { AppContext } from "../context/AppContext";
import {formatPrompt} from "./constants";

type CommandFn = (args: string[], ctx: AppContext) => void | Promise<void>;

export type FSEntry = {
  type: "file" | "dir";
  path: string;
  size?: number;
  ts?: Date;
};

export const commands: { [key: string]: CommandFn } = {
  clear: (_, { term }) => {
    if (!term) return;
    term.write("", () => term.clear());
  },
  whoami: (_, { term }) => {
    if (!term) return;
    term.writeln("sam");
  },
  ls: async (args, { agent, term }) => {
    if (!term || !agent) return;

    const res = await agent.call<FSEntry[]>("ls", [args]);
    let str = "";
    res.forEach((entry: FSEntry) => {
      const slugs = entry.path.split("/");
      const name =
        entry.path.split("/")[slugs.length - (entry.type === "file" ? 1 : 2)];
      str += (entry.type === "file" ? name : `\x1b[1m${name}\x1b[0m`) + "\t";
    });
    term.writeln(str);
  },
  cat: async (args, { agent, term }) => {
    if (!term || !agent) return;
    // convert to abs path
    await agent.call("cat", [args], {
      onChunk: (chunk: any) => {
        const arr = Uint8Array.from(Object.values(chunk));
        term.write(arr);
      },
      onDone: () => term.writeln(""),
    });
  },
  cd: async (args, { agent, term , prompt}) => {
    if (!term || !agent) return;

    const cwd = await agent.call<string>("cd", [args]);
    if (!cwd) return;
    prompt.current = formatPrompt(cwd);
  },
};
