import {
  Agent,
  getAgentByName,
  unstable_callable as callable,
  StreamingResponse,
} from "agents";

type State = {
  cwd: string;
};

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

  async getFile(path: string): Promise<FSEntry | null> {
    const obj = await this.env.FILE_SYSTEM.get(path);
    if (!obj) {
      return null;
    }
    const entry: FSEntry = {
      path: obj.key,
      content: obj.body, // this is a RedableStream
      type: "file",
      size: obj.size,
      ts: obj.uploaded,
    };
    return entry;
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
          stream.send(value); // Process each chunk here
        }
      }
    } finally {
      reader.releaseLock();
    }
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
