import {
  Agent,
  getAgentByName,
  unstable_callable as callable,
  StreamingResponse,
} from "agents";

type State = {
  cwd: string;
};

const openFileDescriptors = new Map<string, WritableStream>();

export class Quorra extends Agent<Env, State> {
  onStart(): void | Promise<void> {
    if (!this.state) {
      // set initial state
      this.setState({ cwd: "/" });
    }
  }
  // syscalls
  async listDir(path: string): Promise<FSEntry[]> {
    const list = await this.env.FILE_SYSTEM.list({
      prefix: path,
      delimiter: "/",
    });

    const entries: FSEntry[] = [
      ...list.objects.map((obj) => ({
        type: "file" as const,
        path: obj.key,
        size: obj.size,
        ts: obj.uploaded,
      })),

      ...list.delimitedPrefixes.map((pref) => ({
        type: "dir" as const,
        path: pref,
      })),
    ];
    return entries.sort();
  }

  async getFile(path: string, headOnly = false): Promise<FSEntry | null> {
    const obj = await this.env.FILE_SYSTEM[headOnly ? "head" : "get"](path);
    if (!obj) {
      return null;
    }
    const entry: FSEntry = {
      path: obj.key,
      type: "file",
      size: obj.size,
      ts: obj.uploaded,
    };
    if (!headOnly) entry.content = (obj as any).body; // this is a RedableStream
    return entry;
  }

  @callable()
  open(path: string, size: number) {
    // get file desc
    const { readable, writable } = new FixedLengthStream(size);
    const absPath = this.toAbsolutePath(path);
    openFileDescriptors.set(absPath, writable);
    const uploadPromise = this.env.FILE_SYSTEM.put(absPath, readable);
    this.ctx.waitUntil(
      (async () => {
        try {
          await uploadPromise;
        } catch (e) {
          console.error(e);
        }
      })()
    );
  }

  @callable()
  async close(path: string) {
    // get file desc
    const absPath = this.toAbsolutePath(path);
    const stream = openFileDescriptors.get(absPath);
    console.log(stream);
    if (!stream) return;
    await stream.close();
    console.log("closed");
    openFileDescriptors.delete(absPath);
  }

  @callable()
  async writeFile(path: string, data: any) {
    const absPath = this.toAbsolutePath(path);
    const writer = openFileDescriptors.get(absPath)?.getWriter();
    if (!writer) return null;
    console.log(data);

    console.log(Uint8Array.from(Object.values(data)).length)
    await writer.write(Uint8Array.from(Object.values(data)));
    writer.releaseLock();
  }

  toAbsolutePath(path: string) {
    return path.startsWith("/") ? path : this.state.cwd + path;
  }

  // RPC
  @callable()
  async ls(args: string[]) {
    let dirPath =
      args.length > 0 ? this.toAbsolutePath(args[0]) : this.state.cwd;
    return await this.listDir(dirPath);
  }

  @callable()
  async cd(args: string[]) {
    if (args.length != 1) return;

    let newCwd = this.toAbsolutePath(args[0]);
    if (!newCwd.endsWith("/")) newCwd += "/";
    console.log(newCwd);
    const dir = await this.listDir(newCwd);
    if (dir.length > 0) {
      // it exists
      this.setState({ ...this.state, cwd: newCwd });
      return newCwd;
    }
  }

  @callable({ streaming: true })
  async cat(stream: StreamingResponse, args: string[]) {
    if (args.length === 0) return;

    const entry = await this.getFile(this.toAbsolutePath(args[0]));
    if (!entry) return;

    const reader = entry.content!.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          stream.end();
          break;
        } else {
          stream.send(value);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  @callable()
  async file(args: string[]) {
    if (args.length === 0) return;

    const entry = await this.getFile(this.toAbsolutePath(args[0]), true);
    if (!entry) return;

    return entry;
  }
}

export type FSEntry = {
  type: "file" | "dir";
  path: string;
  size?: number;
  ts?: Date;
  content?: ReadableStream;
};
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      const namedAgent = getAgentByName<Env, Quorra>(env.Quorra, "quorra");
      const namedResp = (await namedAgent).fetch(request);
      return namedResp;
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
