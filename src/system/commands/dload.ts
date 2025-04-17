import commandLineArgs, {
  type OptionDefinition,
} from "../../libs/command-line-args";
import { stderr, stdout } from "../constants";
import type { CommandFn, FSEntry } from "../types";

export const options: OptionDefinition[] = [
  { name: "path", defaultOption: true },
];

export const dload: CommandFn = async (argv, { agent, term }) => {
  if (!term || !agent) return;
  const { path } = commandLineArgs(options, { argv });
  if (!path) {
    term.writeln(stdout("Usage: dload [path/to/file]"));
    return;
  }
  const entry = await agent.call<FSEntry>("stat", [path]);
  if (!entry) {
    term.writeln(stderr(`no such file or directory: ${path}`));
  }

  const slugs = entry.path.split("/");
  const fileName = slugs[slugs.length - 1];
  try {
    //@ts-ignore
    const newHandle = await window.showSaveFilePicker({
      suggestedName: fileName,
      startIn: "downloads",
    });

    // create a FileSystemWritableFileStream to write to
    const writableStream = await newHandle.createWritable();
    term.options.cursorBlink = false;

    let progress = 0;
    let size = entry.size!;
    const barLength = 50;
    const stepProgress = (progress: number) => {
      const filled = Math.floor((progress / size) * barLength);
      const empty = barLength - filled;
      const bar = "█".repeat(filled) + "-".repeat(empty);
      const percentage = Math.round((progress / size) * 100);

      // Clear line and move cursor to start before writing
      term.write(stdout("\x1B[2K\r[" + bar + "] " + percentage + "%"));
    };

    stepProgress(progress);
    await agent.call("pipe", ["readfile", path], {
      onChunk: async (chunk: any) => {
        const arr = Uint8Array.from(Object.values(chunk));
        await writableStream.write(arr);
        progress += arr.byteLength;
        stepProgress(progress);
      },
      onDone: () => {},
      onError: (e) => term.writeln(stderr(e)),
    });
    await writableStream.close();
    term.writeln(stdout("\nSuccessfully downloaded."));
    term.options.cursorBlink = true;
    term.focus();
  } catch (e) {
    term.writeln(stderr(e));
  }
};
