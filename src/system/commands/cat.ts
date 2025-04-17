import commandLineArgs, {
  type OptionDefinition,
} from "../../libs/command-line-args";
import { stderr, stdout } from "../constants";
import type { CommandFn } from "../types";

export const options: OptionDefinition[] = [
  { name: "path", defaultOption: true },
];

export const cat: CommandFn = async (argv, { agent, term }) => {
  if (!term || !agent) return;
  let { path } = commandLineArgs(options, { argv });
  if (!path) {
    term.writeln(stdout("Usage: cat [path/to/folder]"));
    return;
  }

  let utf8decoder = new TextDecoder();
  await agent.call("pipe", ["readfile", path], {
    onChunk: (chunk: any) => {
      const arr = Uint8Array.from(Object.values(chunk));
      term.write(stdout(utf8decoder.decode(arr)));
    },
    onDone: () => term.writeln(""),
    onError: (e) => {
      term.writeln(stderr(e));
      return;
    },
  });
};
