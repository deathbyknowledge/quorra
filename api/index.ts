import {
  Agent,
  getAgentByName,
  unstable_callable as callable,
  StreamingResponse,
} from "agents";
import { runWithTools } from "@cloudflare/ai-utils";
import { OpenAI } from "openai";
import { getModelSystemPrompt, getProviderConfig, Model } from "./utils";
import { Stream } from "openai/streaming";
import { createMimeMessage } from "mimetext";
import { EmailMessage } from "cloudflare:email";
import PostalMime from "postal-mime";

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

  toAbsolutePath(path: string, dir = false) {
    // TODO: implement ..
    path = path.startsWith("/") ? path : this.state.cwd + path;
    if (dir && !path.endsWith("/")) path += "/";
    return path;
  }

  async do({ prompt, model = Model.GPT4o }: { prompt: string; model?: Model }) {
    const openai = new OpenAI(getProviderConfig(model));
    const messages = [
      {
        role: "system",
        content: getModelSystemPrompt(model),
      },
      {
        role: "user",
        content: prompt,
      },
    ];

    const generate = async (msgs: any[]) => {
      return await openai.chat.completions.create({
        model,
        tools: [
          {
            type: "function",
            function: {
              name: "readdir",
              description:
                "Lists file system entries in the specified directory path. Returns JSON array of entries, either files or directories with their paths.",
              parameters: {
                type: "object",
                properties: {
                  path: { type: "string" },
                },
                required: ["path"],
              },
            },
          },
        ],
        messages: msgs,
        max_tokens: 1024,
      });
    };

    while (true) {
      const response = (await generate(
        messages
      )) as OpenAI.Chat.Completions.ChatCompletion;
      const result = response.choices[0].message;
      if (result.tool_calls && result.tool_calls.length > 0) {
        messages.push({
          role: result.role,
          tool_calls: result.tool_calls,
        } as any);
        for (const toolCall of result.tool_calls) {
          if (toolCall.function.name in this) {
            const tool_response = await (
              this[toolCall.function.name as keyof this] as any
            )(JSON.parse(toolCall.function.arguments));
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify(tool_response),
            } as any);
          }
        }
        continue;
      }

      return result.content;
    }
  }

  @callable()
  async ask({
    ask,
    model = Model.GPT4o,
    stream = false,
  }: {
    ask: string;
    model?: Model;
    stream?: boolean;
  }) {
    const openai = new OpenAI(getProviderConfig(model));
    const messages = [
      {
        role: "system",
        content: getModelSystemPrompt(model),
      },
      {
        role: "user",
        content: ask,
      },
    ];

    const generate = async (msgs: any[]) => {
      return await openai.chat.completions.create({
        model,
        tools: [
          {
            type: "function",
            function: {
              name: "readdir",
              description:
                "Lists file system entries in the specified directory path. Returns JSON array of entries, either files or directories with their paths.",
              parameters: {
                type: "object",
                properties: {
                  path: { type: "string" },
                },
                required: ["path"],
              },
            },
          },
        ],
        stream,
        messages: msgs,
        max_tokens: 1024,
      });
    };

    if (stream) {
      // return a ReadableStream including only output text
      const stream = (await generate(
        messages
      )) as Stream<OpenAI.Chat.Completions.ChatCompletionChunk>;
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
      while (true) {
        const response = (await generate(
          messages
        )) as OpenAI.Chat.Completions.ChatCompletion;
        const result = response.choices[0].message;
        if (result.tool_calls && result.tool_calls.length > 0) {
          messages.push({
            role: result.role,
            tool_calls: result.tool_calls,
          } as any);
          for (const toolCall of result.tool_calls) {
            if (toolCall.function.name in this) {
              const tool_response = await (
                this[toolCall.function.name as keyof this] as any
              )(JSON.parse(toolCall.function.arguments));
              messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(tool_response),
              } as any);
            }
          }
          continue;
        }

        return result.content;
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
    console.log(newCwd);
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

  async email(message, env) {
    const email = await PostalMime.parse(message.raw);
    // const quorra = await getAgentByName<Env, Quorra>(env.Quorra, "quorra");
    const subject = email.subject?.startsWith("Re: ")
      ? email.subject
      : `Re: ${email.subject}`;

    const handleEmail = async ({
      shouldStore,
      reply,
    }: {
      shouldStore: boolean;
      reply: string;
    }) => {
      if (reply) {
        const msg = createMimeMessage();
        msg.setHeader("In-Reply-To", message.headers.get("Message-ID")!);
        msg.setHeader("References", message.headers.get("Message-ID")!);
        msg.setSender({
          name: "Quorra",
          addr: "quorra@deathbyknowledge.com",
        });
        msg.setRecipient(message.from);
        msg.setSubject(subject);
        msg.addMessage({
          contentType: "text/plain",
          data: reply,
        });

        const replyMessage = new EmailMessage(
          "quorra@deathbyknowledge.com",
          message.from,
          msg.asRaw()
        );

        await message.reply(replyMessage);
      }

      if (shouldStore || true) {
        // debugging
        const now = new Date();
        const id = crypto.randomUUID().slice(0, 8);
        const path = `/var/mail/${now.getUTCFullYear()}${now.getUTCMonth()}${now.getUTCDate()}_${id}.txt`;

        await env.FILE_SYSTEM.put(
          path,
          `FROM: [${email.from.name} (${email.from.address})]
SUBJECT: ${email.subject}
CONTENT:
${email.text ?? email.html}
${reply ? `\n\nQUORRA REPLY:\nSUBJECT: ${subject}\nCONTENT:\n${reply}` : ""}`
        );
      }
    };

    const rejectEmail = ({ reason }: { reason: string }) => {
      message.setReject(reason);
    };

    const callFunction = async (name: string, args: any) => {
      if (name === "handleEmail") {
        return handleEmail(args);
      }
      if (name === "rejectEmail") {
        return rejectEmail(args);
      }
    };
    const model = Model.GPT4o;
    const openai = new OpenAI(getProviderConfig(model));
    const messages = [
      {
        role: "system",
        content: getModelSystemPrompt(model),
      },
      {
        role: "user",
        content: `[AUTOMATED SYSTEM MESSAGE] Hey Quorra, you are in psyop firewall mode. You've been awoken because a new email has arrived. I need you to filter the email for me. Since this is some random's email, I've restricted your syscalls in this mode to email functionality only.
Before I tell you what to filter out, you should be aware that people might refer to me with different names; Steve James, Caise Ponce, deathbyknowledge, dbk. Do not be weirded out by this.

I need you to have based replies. Now, for what to filter:
- Crypto job offers. I've had enough of them. Feel free to reply by telling them to fuck off.
- General marketing/service spam. Do not reply, just reject the mail.
- Mails from services I've probably signed up to, store them.
- Any other email from individuals addressing me directly, store the mail and reply letting them know I'll be in touch shortly. Always sign your e-mails. Be yourself. Your emails will be using quorra@deathbyknowledge.com.

Now, here's the email:
<email>
FROM: [${email.from.name} (${email.from.address})]
CONTENT:
${email.text ?? email.html}
</email>
`,
      },
    ];

    const generate = async (msgs: any[]) => {
      return await openai.chat.completions.create({
        model,
        tool_choice: "required",
        tools: [
          {
            type: "function",
            function: {
              name: "handleEmail",
              description: "Handles the email when it is NOT to be rejected.",
              parameters: {
                type: "object",
                properties: {
                  shouldStore: {
                    type: "boolean",
                    descrption: "Whether this email needs to be stored.",
                  },
                  reply: {
                    type: "string",
                    descrption:
                      "Optional field for the reply. When unset, no reply will be sent. ",
                  },
                },
                required: ["shouldStore"],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "rejectEmail",
              description:
                "Rejects the email with the given reason. The user will not receive it.",
              parameters: {
                type: "object",
                properties: {
                  reason: {
                    type: "string",
                    descrption:
                      "The reason to give the sending client of why their email was rejected. Be based.",
                  },
                },
                required: ["reason"],
              },
            },
          },
        ],
        messages: msgs,
        max_tokens: 1024,
      });
    };

    const response = (await generate(
      messages
    )) as OpenAI.Chat.Completions.ChatCompletion;
    const result = response.choices[0].message;
    if (result.tool_calls && result.tool_calls.length > 0) {
      console.log(JSON.stringify(result.tool_calls, null, 2));
      for (const toolCall of result.tool_calls) {
        const name = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments);
        await callFunction(name, args);
      }
    }
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
