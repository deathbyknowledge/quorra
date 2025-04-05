import commandLineArgs, {
  OptionDefinition,
} from "../../libs/command-line-args";
import { CommandFn } from "../types";

export const options: OptionDefinition[] = [
  { name: "path", defaultOption: true },
];

export const cat: CommandFn = async (argv, { agent, term }) => {
  if (!term || !agent) return;
  let { path } = commandLineArgs(options, { argv });
  if (!path) {
    term.writeln("Usage: cat [path/to/folder]");
    return;
  }

  await agent.call("pipe", ["readfile", path], {
    onChunk: (chunk: any) => {
      const arr = Uint8Array.from(Object.values(chunk));
      term.write(arr);
    },
    onDone: () => term.writeln(""),
    onError: (e) => term.writeln(`Error: ${e}`),
  });
};
