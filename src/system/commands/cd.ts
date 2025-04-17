import commandLineArgs, {
  type OptionDefinition,
} from "../../libs/command-line-args";
import { formatPrompt, stderr, stdout } from "../constants";
import { type CommandFn } from "../types";

export const options: OptionDefinition[] = [
  { name: "path", defaultOption: true },
];

export const cd: CommandFn = async (argv, { agent, term, prompt }) => {
  if (!term || !agent) return;
  let { path } = commandLineArgs(options, { argv });
  if (!path) {
    term.writeln(stdout("Usage: cd [path/to/folder]"));
    return;
  }
  if (!path.endsWith("/")) path += "/";

  const cwd = await agent.call<string>("chdir", [path]);
  if (!cwd) {
    term.writeln(stderr(`no such directory: ${path}`));
    return;
  }
  prompt.current = formatPrompt(cwd);
};
