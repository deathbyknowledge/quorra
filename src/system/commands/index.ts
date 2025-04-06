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
  spawn: async (_, { agent, term }) => {
    const taskId = await agent?.call("scheduleTest", []);
    term?.writeln(`Spawned ${taskId}.`);
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
    const success = await agent.call("kill", [args[0]]);
    term?.writeln(success ? "Done." : "Could not kill process.");
  },
  rm,
  ask,
  open: async (args, ctx) => {
    ctx.setFilePath(args[0]);
  },
};
