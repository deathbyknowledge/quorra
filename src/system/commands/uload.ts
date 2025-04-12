import commandLineArgs, {
  OptionDefinition,
} from "../../libs/command-line-args";
import { CommandFn, FSEntry } from "../types";

export const options: OptionDefinition[] = [
  { name: "path", defaultOption: true },
];

export const uload: CommandFn = async (argv, { agent, term }) => {
  if (!term || !agent) return;
  const { path } = commandLineArgs(options, { argv });
  if (!path) {
    term.writeln("Usage: dload [path/to/file]");
    return;
  }

  // Open file picker and destructure the result the first handle
  try {
    const [fileHandle] = await window.showOpenFilePicker();
    const file = await fileHandle.getFile();
    const fstream = file.stream();
    const freader = fstream.getReader();
    term.options.cursorBlink = false;

    let size = file.size;
    const barLength = 50;
    const stepProgress = (progress: number) => {
      const filled = Math.floor((progress / size) * barLength);
      const empty = barLength - filled;
      const bar = "█".repeat(filled) + "-".repeat(empty);
      const percentage = Math.round((progress / size) * 100);

      // Clear line and move cursor to start before writing
      term.write("\x1B[2K\r[" + bar + "] " + percentage + "%");
    };
    await agent.call<FSEntry>("open", [path, size]);
    let total = 0;
    stepProgress(total);
    while (true) {
      const { done, value } = await freader.read();
      if (done) {
        await agent.call<FSEntry>("close", [path]);
        term.writeln("Succesfully uloaded.");
        term.options.cursorBlink = true;
        break;
      }
      if (value) {
        const chunkSize = 1024 * 16; // 16KB
        let offset = 0;
        while (true) {
          if (value.byteLength - offset > chunkSize) {
            const chunk = value.slice(offset, offset + chunkSize);
            await agent.call<FSEntry>("writefile", [path, chunk]);
            total += chunkSize;
            offset += chunkSize;
            stepProgress(total);
          } else {
            const chunk = value.slice(offset);
            await agent.call<FSEntry>("writefile", [path, chunk]);
            total += chunk.byteLength;
            stepProgress(total);
            break;
          }
        }
      }
    }
  } catch (e) {
    term.writeln(`uload error: ${e}`);
    term.options.cursorBlink = true;
  }
};
