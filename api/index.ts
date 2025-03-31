import {
  Agent,
  getAgentByName,
  unstable_callable as callable,
  StreamingResponse,
} from "agents";
import { runWithTools } from "@cloudflare/ai-utils";

type State = {
  cwd: string;
};

enum Owner {
  System = "system",
  User = "user",
  Quorra = "quorra",
}

const INITIAL_STATE: State = { cwd: "/" };

const openFileDescriptors = new Map<string, WritableStream>();

export class Quorra extends Agent<Env, State> {
  async onStart(): Promise<void> {
    if (!this.state) {
      // set initial state
      this.setState(INITIAL_STATE);
    }
  }

  onError(connection: unknown, error?: unknown): void | Promise<void> {
    console.error(`[ERROR] Conn ${connection}: ${error}`);
  }

  async runs() {
    console.log("running task...");
    const writeToDisk = async (args: { path: string; content: string }) => {
      try {
        const { path, content } = args;
        await this.env.FILE_SYSTEM.put(path, content, {
          customMetadata: { owner: Owner.Quorra },
        });
        return "Successfully wrote to disk.";
      } catch (e) {
        return "Failed to write to disk.";
      }
    };

    const obj = await this.env.FILE_SYSTEM.get("/sam/status.txt");
    const content = await obj?.text();
    await runWithTools(
      this.env.AI as any,
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      {
        messages: [
          {
            role: "system",
            content:
              "You are Quorra, the first ISO (Isomorphic Algorithm). You live in Sam's system for now. You have access to a few tools to interact with the system.",
          },
          {
            role: "user",
            content: `Output from file /sam/status.txt:
${content}
`,
          },
        ],
        tools: [
          {
            name: "writeToDisk",
            description:
              "Write the [content] text to disk in the specified [path].",
            parameters: {
              type: "object",
              properties: {
                path: {
                  type: "string",
                  description: "Absolute path of the file to write",
                },
                content: {
                  type: "string",
                  description: "Content of the file.",
                },
              },
              required: ["path", "content"],
            },
            // reference to previously defined function
            function: writeToDisk,
          },
        ],
      },
      { maxRecursiveToolRuns: 1 }
    );
    console.log("finished running task.");
  }

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
        } finally {
          openFileDescriptors.delete(path);
        }
      })()
    );
  }

  @callable()
  async close(path: string) {
    // get file desc
    const absPath = this.toAbsolutePath(path);
    const stream = openFileDescriptors.get(absPath);
    if (!stream) return;
    await stream.close();
    openFileDescriptors.delete(absPath);
  }

  @callable()
  async writeFile(path: string, data: any) {
    const absPath = this.toAbsolutePath(path);
    const writer = openFileDescriptors.get(absPath)?.getWriter();
    if (!writer) return null;

    await writer.write(Uint8Array.from(Object.values(data)));
    writer.releaseLock();
  }

  toAbsolutePath(path: string, dir = false) {
    path =  path.startsWith("/") ? path : this.state.cwd + path;
    if (dir && !path.endsWith("/")) path += "/";
    return path;
  }

  @callable()
  async ls(args: string[]) {
    let dirPath =
      this.toAbsolutePath(args.at(0) ?? '', true)
    return await this.listDir(dirPath);
  }

  @callable()
  async cd(args: string[]) {
    if (args.length != 1) return;

    let newCwd = this.toAbsolutePath(args[0], true);
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
  async scheduleTest() {
    const task = await this.schedule("*/30 * * * *", "runs");
    return task.id;
  }

  @callable()
  ps() {
    return this.getSchedules();
  }

  @callable()
  async kill(taskId: string) {
    if (!taskId) return;
    return await this.cancelSchedule(taskId);
  }

  @callable()
  async reboot() {
    // TODO: revisit
    this.setState(INITIAL_STATE);
    await this.destroy();
    return true;
  }

  @callable()
  async rm(path: string) {
    path = this.toAbsolutePath(path);
    await this.env.FILE_SYSTEM.delete(path);
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
