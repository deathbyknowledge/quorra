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
    await agent.call<FSEntry>("open", [path, file.size]);
    let total = 0;
    while (true) {
      const { done, value } = await freader.read();
      if (done) {
        await agent.call<FSEntry>("close", [path]);
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
          } else {
            const chunk = value.slice(offset);
            total += chunk.byteLength;
            await agent.call<FSEntry>("writefile", [path, chunk]);
            break;
          }
        }
      }
    }
  } catch (e) {
    term.writeln(`uload error: ${e}`);
  }
};
