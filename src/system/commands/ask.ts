import commandLineArgs, {
  OptionDefinition,
} from "../../libs/command-line-args";
import { CommandFn } from "../types";
import { Model } from "../../../api/utils";

const modelOptions: { [key: string]: Model } = {
  deepseek: Model.DeepSeekV3,
  gpt4: Model.GPT4o,
  hermes: Model.Hermes70B,
  deephermes: Model.DeepHermes24B,
};

const options: OptionDefinition[] = [
  { name: "prompt", defaultOption: true, multiple: true },
  { name: "files", alias: "f", lazyMultiple: true },
  { name: "model", alias: "m", defaultValue: "gpt4" },
  { name: "stream", alias: "s", defaultValue: false, type: Boolean },
];

export const ask: CommandFn = async (argv, { agent, term }) => {
  if (!term || !agent) return;
  const { prompt, model, stream } = commandLineArgs(options, { argv });
  if (!prompt || prompt.length < 1) {
    term.writeln("Usage: ask [your ask] [-f] [-m model]");
    return;
  }
  if (!(model in modelOptions)) {
    term.writeln(
      `Error: unsupported model option ${model}. Supported options are ${Object.keys(
        modelOptions
      ).join(", ")}.`
    );
    return;
  }
  const modelId = modelOptions[model];
  if (stream) {
    await agent.call(
      "pipe",
      ["ask", { ask: prompt.join(" "), model: modelId, stream }],
      {
        onChunk: (chunk: any) => {
          term.write(chunk);
        },
        onDone: () => term.writeln(""),
      }
    );
  } else {
    const res = await agent.call("ask", [
      { ask: prompt.join(" "), model: modelId, stream },
    ]);
    term.writeln(res as string);
  }
};
