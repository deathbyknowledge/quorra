import commandLineArgs, {
  type OptionDefinition,
} from "../../libs/command-line-args";
import { stderr, stdout } from "../constants";
import type { CommandFn, FSEntry } from "../types";

export const options: OptionDefinition[] = [
  { name: "path", defaultOption: true },
];

export const file: CommandFn = async (argv, { agent, term }) => {
  if (!term || !agent) return;
  const { path } = commandLineArgs(options, { argv });
  if (!path) {
    term.writeln(stdout("Usage: file [path/to/file]"));
    return;
  }

  const entry = await agent.call<FSEntry>("stat", [path]);
  if (!entry) {
    term.writeln(stderr(`no such file or directory: ${path}`));
    return;
  }
  //TODO: pretty
  term.writeln(stdout(JSON.stringify(entry, null, 2)));
};
