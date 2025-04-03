import commandLineArgs, {
    OptionDefinition,
  } from "../../libs/command-line-args";
  import { CommandFn } from "../types";
  
    const options: OptionDefinition[] = [
      { name: "prompt", defaultOption: true, multiple: true },
      { name: "files", alias: "f", lazyMultiple: true },
    ];
  
  export const ask: CommandFn = async (argv, { agent, term }) => {
    if (!term || !agent) return;
    const { prompt } = commandLineArgs(options, { argv });
    if (!prompt || prompt.length < 1) {
      term.writeln("Usage: ask [your ask] [-f]");
      return;
    }
    await agent.call("pipe", ['ask', prompt.join(" "), true], {
      onChunk: (chunk: any) => {
        term.write(chunk);
      },
      onDone: () => term.writeln(""),
    });
  };
  