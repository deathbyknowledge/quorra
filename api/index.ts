import { Agent, getAgentByName } from "agents";

type State = {
  cwd: string;
};

export class Quorra extends Agent<Env, State> {
  async onStart() {
    console.log("a");
    await this.env.FILE_SYSTEM.put("/test.txt", "Hello from the grid!\n:)");
    await this.env.FILE_SYSTEM.put("/folder/test.txt", "Hello agane!");
  }
  async onRequest(request: Request): Promise<Response> {
    try {
      const { type, data } = await request.json<{ type: string; data: any }>();
      switch (type) {
        case "cmd":
          const [cmd, ...args] = (data as string).split(" ");
          const cmdAsMethod = `q_${cmd}` as keyof Quorra; // q_[cmd name] to avoid clashes
          if (cmdAsMethod in this && typeof this[cmdAsMethod] === "function") { // pleasing ts
            const method = this[cmdAsMethod] as (args: string[]) => Promise<Response>;
            return method.call(this, args);
          }
          break;
        case "kill":
      }
    } catch (error) {
      console.error(error);
    }
    return new Response("not found", { status: 404 });
  }

  // File System
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

  // Commands
  async q_ls(args: string[]): Promise<Response> {
    const dirEntries = await this.listDir(args.length === 0 ? "/" : args[0]);
    return Response.json(dirEntries);
  }

  async q_cat(args: string[]): Promise<Response> {
    if (args.length === 0) {
      return Response.json({ error: "No file selected." }, { status: 400 });
    } else {
      const entry = await this.getFile("/" + args[0]);
      if (!entry) {
        return Response.json({ error: "Not found." }, { status: 404 });
      }
      return new Response(entry.content);
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
