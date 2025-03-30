import { AppContext } from "../context/AppContext";
import { formatPrompt } from "./constants";

type CommandFn = (args: string[], ctx: AppContext) => void | Promise<void>;

export type FSEntry = {
  type: "file" | "dir";
  path: string;
  size?: number;
  ts?: Date;
};

export const commands: { [key: string]: CommandFn } = {
  clear: (_, { term }) => {
    if (!term) return;
    term.write("", () => term.clear());
  },
  whoami: (_, { term }) => {
    if (!term) return;
    term.writeln("sam");
  },
  ls: async (args, { agent, term }) => {
    if (!term || !agent) return;

    const res = await agent.call<FSEntry[]>("ls", [args]);
    let str = "";
    res.forEach((entry: FSEntry) => {
      const slugs = entry.path.split("/");
      const name =
        entry.path.split("/")[slugs.length - (entry.type === "file" ? 1 : 2)];
      str += (entry.type === "file" ? name : `\x1b[1m${name}\x1b[0m`) + "\t";
    });
    term.writeln(str);
  },
  cat: async (args, { agent, term }) => {
    if (!term || !agent) return;
    // convert to abs path
    await agent.call("cat", [args], {
      onChunk: (chunk: any) => {
        const arr = Uint8Array.from(Object.values(chunk));
        term.write(arr);
      },
      onDone: () => term.writeln(""),
    });
  },
  cd: async (args, { agent, term, prompt }) => {
    if (!term || !agent) return;

    const cwd = await agent.call<string>("cd", [args]);
    if (!cwd) return;
    prompt.current = formatPrompt(cwd);
  },
  file: async (args, { agent, term }) => {
    if (!term || !agent) return;
    const entry = await agent.call<FSEntry>("file", [args]);
    //TODO: pretty
    term.writeln(JSON.stringify(entry, null, 2));
  },
  dload: async (args, { agent, term }) => {
    if (!term || !agent) return;
    if (args.length != 1) {
      term.writeln("Usage: dload [path/to/file]");
      return;
    }
    const entry = await agent.call<FSEntry>("file", [args]);
    if (!entry) {
      term.writeln(`${args[0]} does not exist.`);
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

      await agent.call("cat", [args], {
        onChunk: async (chunk: any) => {
          const arr = Uint8Array.from(Object.values(chunk));
          await writableStream.write(arr);
        },
        onDone: () => term.writeln(""),
        onError: () => term.writeln(""),
      });
      await writableStream.close();
      term.writeln("Complete.");
    } catch (e) {
      term.writeln(`dload error: ${e}`);
    }
  },
  uload: async (args, { agent, term }) => {
    if (!term || !agent) return;
    if (args.length != 1) {
      term.writeln("Usage: dload [path/to/file]");
      return;
    }

    const path = args[0];

    // Open file picker and destructure the result the first handle
    try {
      const [fileHandle] = await window.showOpenFilePicker();
      const file = await fileHandle.getFile();
      const fstream = file.stream();
      const freader = fstream.getReader();
      await agent.call<FSEntry>("open", [path, file.size]);
      let total = 0;
      console.log("opened", file.size);
      while (true) {
        const { done, value } = await freader.read();
        if (done) {
          console.log("done", total);
          await agent.call<FSEntry>("close", [path]);
          break;
        }
        console.log("value len", value?.length);
        if (value) {
          const chunkSize = 1024 * 16; // 16KB
          let offset = 0;
          while (true) {
            console.log("len", value.length, offset, chunkSize);
            if (value.byteLength - offset > chunkSize) {
              console.log("chunk");
              const chunk = value.slice(
                offset,
                offset + chunkSize
              );
              await agent.call<FSEntry>("writeFile", [path, chunk]);
              total += chunkSize;
              offset += chunkSize;
            } else {
              const chunk = value.slice(offset);
              total += chunk.byteLength;
              await agent.call<FSEntry>("writeFile", [path, chunk]);
              break;
            }
          }
        }
      }
    } catch (e) {
      term.writeln(`uload error: ${e}`);
    }
  },
};
