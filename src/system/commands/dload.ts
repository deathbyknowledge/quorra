import commandLineArgs, {
  OptionDefinition,
} from "../../libs/command-line-args";
import { CommandFn, FSEntry } from "../types";

export const options: OptionDefinition[] = [
  { name: "path", defaultOption: true },
];

export const dload: CommandFn = async (argv, { agent, term }) => {
  if (!term || !agent) return;
  const { path } = commandLineArgs(options, { argv });
  if (!path) {
    term.writeln("Usage: dload [path/to/file]");
    return;
  }
  const entry = await agent.call<FSEntry>("stat", [path]);
  if (!entry) {
    term.writeln(`${path} does not exist.`);
  }

  const slugs = entry.path.split("/");
  const fileName = slugs[slugs.length - 1];
  try {
    const newHandle = await window.showSaveFilePicker({
      suggestedName: fileName,
      startIn: "downloads",
    });

    // create a FileSystemWritableFileStream to write to
    const writableStream = await newHandle.createWritable();

    await agent.call("pipe", ['readfile', path], {
      onChunk: async (chunk: any) => {
        const arr = Uint8Array.from(Object.values(chunk));
        await writableStream.write(arr);
      },
      onError: () => term.writeln(""),
    });
    await writableStream.close();
    term.writeln("Complete.");
  } catch (e) {
    term.writeln(`dload error: ${e}`);
  }
};
