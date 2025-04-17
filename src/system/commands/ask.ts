import commandLineArgs, {
  OptionDefinition,
} from "../../libs/command-line-args";
import { CommandFn } from "../types";

const options: OptionDefinition[] = [
  { name: "prompt", defaultOption: true, multiple: true },
  { name: "files", alias: "f", lazyMultiple: true },
  { name: "stream", alias: "s", defaultValue: false, type: Boolean },
];

export const ask: CommandFn = async (argv, { agent, term }) => {
  if (!term || !agent) return;
  const { prompt, stream } = commandLineArgs(options, { argv });
  if (!prompt || prompt.length < 1) {
    term.writeln("Usage: ask [your ask] [-f] [-m model]");
    return;
  }
  if (stream) {
    await agent.call(
      "pipe",
      ["ask", { ask: prompt.join(" "), stream }],
      {
        onChunk: (chunk: any) => {
          term.write(chunk);
        },
        onDone: () => term.writeln(""),
      }
    );
  } else {
    const res = await agent.call("ask", [
      { ask: prompt.join(" "), stream },
    ]);
    term.writeln(res as string);
  }
};
