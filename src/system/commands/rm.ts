import commandLineArgs, {
    OptionDefinition,
  } from "../../libs/command-line-args";
  import { CommandFn } from "../types";
  
  export const options: OptionDefinition[] = [
    { name: "paths", defaultOption: true, multiple: true },
  ];
  
  export const rm: CommandFn = async (argv, { agent, term }) => {
    if (!term || !agent) return;
    let { paths } = commandLineArgs(options, { argv });
    if (!paths) {
      term.writeln("Usage: rm [path/to/file]");
      return;
    }
    await agent.call("unlink", [paths]);
  };
  