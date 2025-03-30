import {
  Agent,
  getAgentByName,
  unstable_callable as callable,
  StreamingResponse,
} from "agents-v2";

type State = {
  cwd: string;
};

enum Owner {
  System = "system",
  User = "user",
  Quorra = "quorra",
}

const openFileDescriptors = new Map<string, WritableStream>();

export class Quorra extends Agent<Env, State> {
  async onStart(): Promise<void> {
    if (!this.state) {
      // set initial state
      this.setState({ cwd: "/" });
    }
  }

  async runs() {
    console.log("running task...");
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
        owner: (obj.customMetadata?.owner as Owner) ?? Owner.User,
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
  open(path: string, size: number, owner = "user") {
    // get file desc
    const { readable, writable } = new FixedLengthStream(size);
    const absPath = this.toAbsolutePath(path);
    openFileDescriptors.set(absPath, writable);
    const uploadPromise = this.env.FILE_SYSTEM.put(absPath, readable, {
      customMetadata: { owner },
    });
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

    console.log(Uint8Array.from(Object.values(data)).length);
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

  @callable()
  async scheduleTest(description?: string) {
    const task = await this.schedule("*/1 * * * *", "runs", { description });
    return task.id;
  }

  @callable()
  ps(description?: string) {
    return this.getSchedules({ description });
  }

  @callable()
  async kill(taskId: string) {
    if (!taskId) return;
    return await this.cancelSchedule(taskId);
  }

  @callable()
  reboot() {
    this.ctx.waitUntil(
      (async () => {
        this.ctx.getWebSockets().forEach((ws) => ws.close());
        await this.destroy();
      })()
    );
    return true;
  }
}

export type FSEntry = {
  type: "file" | "dir";
  path: string;
  size?: number;
  ts?: Date;
  content?: ReadableStream;
  owner?: Owner;
};

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      const b64Key = readCookieValue(request, "auth");
      if (!b64Key) return new Response("missing auth", { status: 400 });
      const key = atob(b64Key);
      if (key != env.SECRET_KEY) return new Response("gtfo", { status: 401 });

      const namedAgent = getAgentByName<Env, Quorra>(env.Quorra, "quorra");
      const namedResp = (await namedAgent).fetch(request);
      return namedResp;
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

const readCookieValue = (req: Request, key: string) => {
  const cookie = req.headers
    .get("cookie")
    ?.split(" ")
    .find((val) => val.startsWith(key));
  if (!cookie) return;

  let value = cookie.split("=")[1];
  if (value.endsWith(";")) value = value.slice(0, -1);
  return value;
};
