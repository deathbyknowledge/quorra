import commandLineArgs, {
    OptionDefinition,
  } from "../../libs/command-line-args";
  import { CommandFn } from "../types";
  
  export const options: OptionDefinition[] = [
    { name: "path", defaultOption: true },
  ];
  
  export const rm: CommandFn = async (argv, { agent, term }) => {
    if (!term || !agent) return;
    let { path } = commandLineArgs(options, { argv });
    if (!path) {
      term.writeln("Usage: cd [path/to/folder]");
      return;
    }
    await agent.call("unlink", [path]);
  };
  