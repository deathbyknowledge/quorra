import {
  Agent,
  getAgentByName,
  unstable_callable as callable,
  StreamingResponse,
} from "agents";
import { runWithTools } from "@cloudflare/ai-utils";
import { OpenAI } from "openai";
import {
  formatEmailAsString,
  getModelSystemPrompt,
  getProviderConfig,
  Model,
} from "./utils";
import PostalMime from "postal-mime";
import { generateCallFunction, getToolDefsByMode, Mode } from "./tools";
import { QUORRA_MAIL_PROMPT_PREAMBLE } from "./constants";

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

  // async onRequest(_: Request): Promise<Response> {
  //   await notifyUser("Good news: Quorra is online.");
  //   return new Response(null, { status: 200 });
  // }

  toAbsolutePath(path: string, dir = false) {
    // TODO: implement ..
    path = path.startsWith("/") ? path : this.state.cwd + path;
    if (dir && !path.endsWith("/")) path += "/";
    return path;
  }

  async automatedExecution({
    ask,
    deps,
    model = Model.GPT4o,
    mode = Mode.AllSyscalls,
    maxSequentialCalls = 1,
  }: {
    ask: string;
    maxSequentialCalls?: number;
    model?: Model;
    mode: Mode;
    deps?: any;
  }) {
    const openai = new OpenAI(getProviderConfig(model));
    const messages: any = [
      {
        role: "system",
        content: getModelSystemPrompt(model),
      },
      {
        role: "user",
        content: ask,
      },
    ];
    const tools = getToolDefsByMode(mode);
    const callFunction = await generateCallFunction(mode, deps, this.env);

    let i = 0;
    while (true) {
      const response = await openai.chat.completions.create({
        model,
        tools,
        messages,
        tool_choice: i === 0 ? "required" : "auto",
        max_tokens: 2048,
      });
      const result = response.choices[0].message;
      if (result.tool_calls && result.tool_calls.length > 0) {
        messages.push({
          role: result.role,
          tool_calls: result.tool_calls,
        });
        for (const toolCall of result.tool_calls) {
          const name = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments);
          const toolResponse = await callFunction(name, args);
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResponse),
          });
        }
      }
      i++;
      // exit if reached the limit of sequential calls
      if (i >= maxSequentialCalls) return;
      continue;
    }
  }

  @callable()
  async ask({
    ask,
    deps,
    model = Model.GPT4o,
    mode = Mode.AllSyscalls,
    stream = false,
    maxSequentialCalls = 3,
  }: {
    ask: string;
    mode: Mode;
    deps?: any;
    model?: Model;
    stream?: boolean;
    maxSequentialCalls?: number;
  }) {
    const openai = new OpenAI(getProviderConfig(model));
    const messages: any = [
      {
        role: "system",
        content: getModelSystemPrompt(model),
      },
      {
        role: "user",
        content: ask,
      },
    ];
    const tools = getToolDefsByMode(mode);
    const callFunction = await generateCallFunction(mode, deps, this.env);

    if (stream) {
      // return a ReadableStream including only output text
      const stream = await openai.chat.completions.create({
        model,
        tools,
        messages,
        stream: true,
        max_tokens: 2048,
      });
      return new ReadableStream({
        async start(controller) {
          for await (const chunk of stream) {
            if (chunk.choices)
              controller.enqueue(chunk.choices[0].delta.content);
          }
          controller.close();
        },
      });
    } else {
      let i = 0;
      while (true) {
        const response = await openai.chat.completions.create({
          model,
          tools,
          messages,
          max_tokens: 2048,
        });
        const result = response.choices[0].message;
        if (result.tool_calls && result.tool_calls.length > 0) {
          messages.push({
            role: result.role,
            tool_calls: result.tool_calls,
          } as any);
          for (const toolCall of result.tool_calls) {
            const name = toolCall.function.name;
            const args = JSON.parse(toolCall.function.arguments);
            const toolResponse = await callFunction(name, args);
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify(toolResponse),
            });
          }
        } else {
          return result.content;
        }
        i++;
        // exit if reached the limit of sequential calls
        if (i >= maxSequentialCalls) return "Model stopped, too many calls";
        continue;
      }
    }
  }

  async runs() {
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

  /*
    SYSCALLS 🤡 
  */

  @callable()
  async readdir({ path }: { path: string }): Promise<FSEntry[]> {
    const list = await this.env.FILE_SYSTEM.list({
      prefix: this.toAbsolutePath(path, true),
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

  @callable()
  async readfile(path: string): Promise<ReadableStream | null> {
    const obj = await this.env.FILE_SYSTEM.get(this.toAbsolutePath(path));
    if (!obj || !obj.body) {
      return null;
    }
    return obj.body;
  }

  @callable()
  async writefile(path: string, data: any) {
    const absPath = this.toAbsolutePath(path);
    const writer = openFileDescriptors.get(absPath)?.getWriter();
    if (!writer) return null;

    await writer.write(Uint8Array.from(Object.values(data)));
    writer.releaseLock();
  }

  @callable()
  async unlink(path: string) {
    path = this.toAbsolutePath(path);
    await this.env.FILE_SYSTEM.delete(path);
  }

  @callable()
  async stat(path: string) {
    const obj = await this.env.FILE_SYSTEM.head(this.toAbsolutePath(path));
    if (!obj) {
      return null;
    }

    const entry: FSEntry = {
      path: obj.key,
      type: "file",
      size: obj.size,
      ts: obj.uploaded,
      owner: obj.customMetadata?.owner as Owner,
    };
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
  async chdir(path: string) {
    let newCwd = this.toAbsolutePath(path, true);
    if (!newCwd.endsWith("/")) newCwd += "/";
    const dir = await this.readdir({ path: newCwd });
    if (dir.length > 0) {
      // it exists
      this.setState({ ...this.state, cwd: newCwd });
      return newCwd;
    }
  }

  @callable({ streaming: true })
  async pipe(stream: StreamingResponse, call: keyof this, ...args: unknown[]) {
    if (!(call in this) || typeof this[call] !== "function") return;
    const content = await this[call](...args);
    if (!content || !(content instanceof ReadableStream)) return;

    const reader = content.getReader();

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
  async spawn() {
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
}

export type FSEntry = {
  type: "file" | "dir";
  path: string;
  size?: number;
  ts?: Date;
  owner?: Owner;
};

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/verify") {
      const b64Key = readCookieValue(request, "auth");
      if (!b64Key) return Response.json({ valid: false }, { status: 401 });
      const key = atob(b64Key);
      if (key != env.SECRET_KEY)
        return Response.json({ valid: false }, { status: 401 });
      return Response.json({ valid: true }, { status: 200 });
    }

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

  // Requires an Email Route to be set up to this worker.
  // I deployed the handler and that made it available in the CF Dashboard under Account > Zone > Email Routing.
  async email(message: ForwardableEmailMessage, env: Env) {
    const email = await PostalMime.parse(message.raw);
    const quorra = await getAgentByName<Env, Quorra>(env.Quorra, "quorra");
    const deps = {
      email,
      reject: (str: string) => message.setReject(str),
      sendReply: async (from: string, to: string, content: string) => {
        const { EmailMessage } = await import("cloudflare:email");
        // creating EmailMessage from the Quorra DO breaks. Have to create it here.
        const replyMessage = new EmailMessage(from, to, content);
        await message.reply(replyMessage);
      },
    };
    const formattedEmail = formatEmailAsString(
      email.from,
      email.subject ?? "",
      email.text ?? email.html ?? ""
    );

    const ask =
      QUORRA_MAIL_PROMPT_PREAMBLE + `<email>\n${formattedEmail}\n</email>`;
    await quorra.automatedExecution({ ask, deps, mode: Mode.Email });
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
