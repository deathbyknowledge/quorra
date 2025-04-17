import { Terminal } from "@xterm/xterm";
import { uload } from "./uload";
import { dload } from "./dload";
import { CommandFn } from "../types";
import { file } from "./file";
import { cd } from "./cd";
import { ls } from "./ls";
import { ask } from "./ask";
import { rm } from "./rm";
import { cat } from "./cat";

export const authCommands: {
  [key: string]: (
    args: string[],
    term: Terminal,
    setKey: (key: string) => void
  ) => void;
} = {
  login: (args, term, setKey) => {
    if (args.length !== 1) {
      term.writeln("Usage: login [password]");
      return;
    }
    setKey(args[0]);
  },
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
  ls,
  cat,
  cd,
  file,
  dload,
  uload,
  reboot: async (_, { agent }) => {
    await agent?.call("reboot", []);
    location.reload();
  },
  spawn: async (args, { agent, term }) => {
    // const taskId = await agent?.call("scheduleTest", []);
    // term?.writeln(`Spawned ${taskId}.`);
    if (!agent || !term) return;
    await agent.call("spawn", [args.join(" ")]);
  },
  ps: async (_, { agent, term }) => {
    const tasks = await agent?.call("ps", []);
    term?.writeln(JSON.stringify(tasks, null, 2));
  },
  kill: async (args, { agent, term }) => {
    if (!term || !agent) return;
    if (args.length != 1) {
      term.writeln("Usage: kill [procId]");
      return;
    }
    await agent.call("kill", [args[0]]);
    term?.writeln(`Process ${args[0]} successfully aborted.`);
  },
  rm,
  ask,
  q: ask,
  open: async (args, ctx) => {
    if (!args.length) return;
    let path = args[0];
    if (!path.startsWith("/")) path = ctx.agentState?.cwd + path;

    ctx.setFilePath(path);
  },
  view: async (args, ctx) => {
    if (!args.length) return;
    let path = args[0];
    if (!path.startsWith("/")) path = ctx.agentState?.cwd + path;

    if (!path.startsWith("/var/www/")) return;
    window.open(location.origin + path.slice(4));
  },
  close: async (_, ctx) => {
    ctx.setFilePath(undefined as any);
  },
  wipe: async (_, ctx) => {
    ctx.agent?.setState({ ...ctx.agentState, conversation: [] } as any);
  },
  test: async (_, { agent }) => {
    if (!agent) return;
    await agent.call("test", []);
  },
};
