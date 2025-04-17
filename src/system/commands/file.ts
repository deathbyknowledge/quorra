import commandLineArgs, {
  type OptionDefinition,
} from "../../libs/command-line-args";
import type { CommandFn, FSEntry } from "../types";

export const options: OptionDefinition[] = [
  { name: "path", defaultOption: true },
];

export const file: CommandFn = async (argv, { agent, term }) => {
  if (!term || !agent) return;
  const { path } = commandLineArgs(options, { argv });
  if (!path) {
    term.writeln("Usage: file [path/to/file]");
    return;
  }

  const entry = await agent.call<FSEntry>("stat", [path]);
  //TODO: pretty
  term.writeln(JSON.stringify(entry, null, 2));
};
