import {
  Agent,
  getAgentByName,
  unstable_callable as callable,
  StreamingResponse,
} from "agents";
import { OpenAI } from "openai";
import PostalMime from "postal-mime";
import {
  generateCallFunction,
  getToolDefsByMode,
  Mode,
  readAsConfig,
  readUserPreferences,
} from "./tools";
import {
  DEFAULT_USER_PREFERENCES,
  MAIL_CONF_PATH,
  MODEL_CONF_PATH,
} from "./constants";
import { z } from "zod";
import { jsonrepair } from "jsonrepair";
import { fs } from "./fs";
import {
  buildPrompt,
  execWithTools,
  formatMailTask,
  getActionPrompt,
  getReasoningPrompt,
  type MailConf,
  type ModelConfig,
  notifyUser,
  toAbsolutePath,
} from "./utils";
import { zodFunction } from "openai/helpers/zod.mjs";
import { type Event, EventType, publishToBus, summarizeAndIndex } from "./bus";
import { env } from "cloudflare:workers";

type State = {
  cwd: string;
  conversation: { from: string; content: string }[];
  flags: { debug: boolean };
  username: string;
};

export enum Owner {
  System = "system",
  User = "user",
  Quorra = "quorra",
}

const INITIAL_STATE: State = {
  cwd: "/",
  conversation: [],
  flags: { debug: true },
  username: env.USERNAME,
};

const PROCS = new Map<
  string,
  { promise: Promise<void>; aborted: boolean; cwd: string; task: string }
>();

type SystemEvent = {
  ts: number;
  level: "info" | "warn" | "error" | "mail" | "proc";
  source: "quorra" | "system" | string;
  message: string;
};

const createSystemEvent = (
  level: "info" | "warn" | "error" | "mail" | "proc",
  source: string,
  message: string
) => ({
  type: "system-event",
  data: { ts: Date.now(), level, source, message },
});

export class Quorra extends Agent<Env, State> {
  async onStart(): Promise<void> {
    // Assume it's first boot.
    if (!this.state) {
      this.setState(INITIAL_STATE);
      const prefsPath = `/home/${INITIAL_STATE.username}/.quorra`; // user prefs re: quorra
      const file = await this.stat(prefsPath);
      if (!file) {
        await this.env.FILE_SYSTEM.put(prefsPath, DEFAULT_USER_PREFERENCES);
      }
    }
  }

  onError(connection: unknown, error?: unknown): void | Promise<void> {
    console.error(`[ERROR] Conn ${connection}: ${error}`);
  }

  log(
    level: "info" | "warn" | "error" | "mail",
    message: string,
    source = "quorra"
  ) {
    const msg = JSON.stringify(
      createSystemEvent(level, source, message),
      null,
      2
    );
    this.broadcast(msg);
    if (!this.isUserOnline()) this.ctx.waitUntil(notifyUser(msg));
  }

  @callable()
  async ask({
    ask,
    stream = false,
    maxSequentialCalls = 15,
  }: {
    ask: string;
    stream?: boolean;
    maxSequentialCalls?: number;
  }) {
    const modelsConf = await readAsConfig<ModelConfig>(MODEL_CONF_PATH).catch(
      (e) => e.toString()
    );
    const preferences = await readUserPreferences(this.state.username);
    const model = modelsConf?.models?.aliases?.[modelsConf?.models?.default];
    if (!model)
      notifyUser(
        `Fix your model config. [models].email not set or not found in ${MODEL_CONF_PATH}.`
      );
    // const model = Model.GPT4o;
    const provider = new OpenAI(model.provider);
    // const openai = new OpenAI(getProviderConfig(model));
    let processes = [];
    for (const [id, { cwd, task }] of PROCS.entries()) {
      processes.push({ id, cwd, task });
    }
    this.setState({
      ...this.state,
      conversation: [
        ...this.state.conversation,
        { from: this.state.username, content: ask },
      ],
    });
    const messages: any = [
      {
        role: "system",
        // content: getModelSystemPrompt(model.name as Model),
        content: buildPrompt(
          this.state.username,
          this.isUserOnline(),
          this.state.cwd,
          JSON.stringify(processes),
          "Empty",
          preferences,
          !this.state.conversation
            ? ""
            : JSON.stringify(this.state.conversation)
        ),
      },
      {
        role: "user",
        content: `<message source="cli">${ask}</message>`,
      },
    ];
    const tools = getToolDefsByMode(Mode.AllSyscalls);
    const callFunction = generateCallFunction(Mode.AllSyscalls, {
      cwd: this.state.cwd,
    });
    const SpawnWorker = z
      .object({
        task: z
          .string()
          .describe(
            "The task this worker process must accomplish (e.g. research <topic> and write the results in results.txt)"
          ),
      })
      .required({ task: true });

    // type SpawnWorkerParams = z.infer<typeof SpawnWorker>;

    const spawnWorkerDef = zodFunction({
      name: "spawnWorker",
      parameters: SpawnWorker,
      description:
        "Spawns an autonomous worker process. Use when a task would benefit of parallelism or to split a complex task into sub-tasks handled by different workers. Returns process id.",
    });

    if (stream) {
      // return a ReadableStream including only output text
      const stream = await provider.chat.completions.create({
        model: model.name,
        tools,
        messages,
        stream: true,
        max_tokens: 2048,
      });
      return new ReadableStream({
        async start(controller) {
          for await (const chunk of stream) {
            // TODO: handle tool calls
            if (chunk.choices)
              controller.enqueue(chunk.choices[0].delta.content);
          }
          controller.close();
        },
      });
    } else {
      let i = 0;
      while (true) {
        const call = async (name: string, args: any) => {
          if (name === "spawnWorker") {
            const { task } = args;
            return await this.spawn(task);
          } else {
            return await callFunction(name, args);
          }
        };
        const res = await execWithTools({
          model: model.name,
          provider,
          messages,
          tools: [...tools, spawnWorkerDef],
          callFunction: call,
        });
        if (typeof res === "string") {
          this.setState({
            ...this.state,
            conversation: [
              ...this.state.conversation,
              { from: "quorra", content: res },
            ],
          });
          return res; // model responded with text
        } else if (Array.isArray(res)) {
          const tool_calls = res.map((result) => result.call);
          this.log(
            "info",
            `${model.name} executed:\n${tool_calls
              .map(
                (call) =>
                  `\t- ${call.function.name}(${call.function.arguments})`
              )
              .join("\n")}`
          );
          messages.push({
            role: "assistant",
            tool_calls,
          } as any);
          res.forEach((result) => {
            const msg = {
              role: "tool",
              tool_call_id: result.call.id,
              content: JSON.stringify(result.result),
            };
            this.setState({
              ...this.state,
              conversation: [
                ...this.state.conversation,
                {
                  from: "quorra (module)",
                  content: JSON.stringify({
                    ...result.call.function,
                    result: "[OMITED]",
                  }),
                },
              ],
            });
            messages.push(msg);
          });
        }
        i++;
        // exit if reached the limit of sequential calls
        if (i >= maxSequentialCalls) return "Model stopped, too many calls";
        continue;
      }
    }
  }

  async autonomousProcess(id: string, task: string) {
    const CWD = `/proc/${id}/`; // Unique CWD per task
    await Promise.all([
      this.env.FILE_SYSTEM.put(CWD + "GOAL.md", task), // should probably have the model expand on this first
      this.env.FILE_SYSTEM.put(
        CWD + "SCRATCHPAD.md",
        "# Iteration 0\nInitial state. Task goal defined in GOAL.md. Ready to determine the first action."
      ),
      this.env.FILE_SYSTEM.put(CWD + "PLAN.md", "- Action: START"), // Placeholder
    ]);

    // Model setup
    const modelsConf = (await readAsConfig<Partial<ModelConfig>>(
      MODEL_CONF_PATH
    ).catch<string>((e) => e.toString())) as Partial<ModelConfig>;
    const actionModel =
      modelsConf?.models?.aliases?.[modelsConf?.models?.autonomous_action];
    const reasonModel =
      modelsConf?.models?.aliases?.[modelsConf?.models?.autonomous_reasoning];
    if (!actionModel || !reasonModel) {
      notifyUser(
        `Fix your model config. [models].email not set or not found in ${MODEL_CONF_PATH}.`
      );
      return;
    }
    // const model = Model.GPT4o;
    const actionProvider = new OpenAI(actionModel.provider);
    const reasonProvider = new OpenAI(reasonModel.provider);
    const tools = getToolDefsByMode(Mode.AllSyscalls);
    const callFunction = generateCallFunction(Mode.AllSyscalls, {
      cwd: this.state.cwd, // tool calls will use the CWD from the user, not the task.
    });

    const cleanup = async () => {
      PROCS.delete(id);
      await this.env.FILE_SYSTEM.delete([
        CWD + "GOAL.md",
        CWD + "SCRATCHPAD.md",
        CWD + "PLAN.md",
      ]);
    };

    const maxIter = 25;
    let iter = 0;
    while (maxIter > iter) {
      // CHECK IF HAS BEEN ABORTED
      let proc = PROCS.get(id);
      if (!proc || proc.aborted) {
        await publishToBus(EventType.ProcessAborted, { id, task });
        await cleanup();
        return;
      }
      iter += 1;
      const objects = await Promise.all([
        this.env.FILE_SYSTEM.get(CWD + "GOAL.md"), // should probably have the model expand on this first
        this.env.FILE_SYSTEM.get(CWD + "SCRATCHPAD.md"),
        this.env.FILE_SYSTEM.get(CWD + "PLAN.md"), // Placeholder
      ]);
      const files = await Promise.all(objects.map((obj) => obj?.text()));
      if (files.includes(undefined)) {
        // should never happen
        this.log(
          "error",
          "Task required files did not exist. Aborting...",
          `proc:${id}`
        );
        return;
      }
      const [goal, scratchpad, plan] = files as string[];
      // STEP 1: ACTION AGENT EXECUTES TOOLS.
      const execResult = await execWithTools({
        model: actionModel.name,
        provider: actionProvider,
        messages: [
          {
            role: "system",
            content: getActionPrompt(goal, scratchpad, plan),
          },
        ],
        tools,
        callFunction,
        options: {
          temp: 0.2,
          topP: 0.95,
          toolChoice: "required",
          maxTokens: 4096,
        },
      });
      const toolCalls: { name: string; args: string }[] = [];
      const toolResults: { name: string; result: string }[] = [];
      if (typeof execResult === "string") {
        // should never happen
        this.log(
          "error",
          `Model was supposed to call a tool. Instead it said ${execResult}`,
          `proc:${id}`
        );
      } else if (Array.isArray(execResult)) {
        execResult.forEach((result) => {
          const name = result.call.function.name;
          toolCalls.push({ name, args: result.call.function.arguments });
          toolResults.push({ name, result: JSON.stringify(result.result) });
        });
        this.log(
          "info",
          `${actionModel.name} executed:\n${toolCalls
            .map(
              (call) => `\t- ${call.name}(${call.args})`
            )
            .join("\n")}`
        );
      }

      const ReasonResult = z
        .object({
          scratchpad_update: z.string(),
          next_plan: z.string(),
          is_complete: z.boolean(),
        })
        .required({
          is_complete: true,
          next_plan: true,
          scratchpad_update: true,
        });

      // Check if aborted again after first Agent call.
      proc = PROCS.get(id);
      if (!proc || proc.aborted) {
        await publishToBus(EventType.ProcessAborted, { id, task });
        await cleanup();
        return;
      }

      // STEP 2: REASON AGENT
      const reasonResponse = await reasonProvider.chat.completions.create({
        model: reasonModel.name,
        messages: [
          {
            role: "user",
            content: getReasoningPrompt(
              goal,
              scratchpad,
              plan,
              toolCalls,
              toolResults
            ),
          },
        ],
        temperature: 0.5,
        top_p: 0.95,
        max_tokens: 4096,
        // response_format: {type} // DeepSeekR1 doesn't support it yet T.T
      });

      const reasoning = reasonResponse.choices[0].message.content as string;
      const {
        scratchpad_update,
        is_complete,
        next_plan,
      }: z.infer<typeof ReasonResult> = JSON.parse(jsonrepair(reasoning));

      if (is_complete) break; // break if reasoner decided it's time (it's time 🙏)

      // update files with outputs
      await Promise.all([
        this.env.FILE_SYSTEM.put(CWD + "GOAL.md", goal), // should probably have the model expand on this first
        this.env.FILE_SYSTEM.put(
          CWD + "SCRATCHPAD.md",
          `${scratchpad}\n${scratchpad_update}`
        ),
        this.env.FILE_SYSTEM.put(CWD + "PLAN.md", next_plan), // Placeholder
      ]);
    }
    await publishToBus(EventType.ProcessFinished, { id, task });
    await cleanup();
  }

  @callable()
  async spawn(task: string) {
    const id = crypto.randomUUID().slice(0, 8);
    const promise = this.autonomousProcess(id, task);
    PROCS.set(id, {
      promise,
      cwd: this.state.cwd,
      aborted: false,
      task,
    });
    await publishToBus(EventType.ProcessSpawned, { id, task });
    return id;
  }

  @callable()
  async readdir({ path }: { path: string }): Promise<FSEntry[]> {
    return fs.readdir({ path: toAbsolutePath(this.state.cwd, path, true) });
  }

  @callable()
  async readfile(path: string): Promise<ReadableStream | null> {
    return fs.readfile(toAbsolutePath(this.state.cwd, path), true);
  }

  @callable()
  async writefile(path: string, data: any) {
    await fs.writefile(toAbsolutePath(this.state.cwd, path), data);
  }

  @callable()
  async unlink(paths: string[]) {
    paths = paths.map((path) => toAbsolutePath(this.state.cwd, path));
    await fs.unlink(paths);
  }

  @callable()
  async stat(path: string) {
    return fs.stat(toAbsolutePath(this.state.cwd, path));
  }

  @callable()
  open(path: string, size: number, owner = "user") {
    this.ctx.waitUntil(
      fs.open(toAbsolutePath(this.state.cwd, path), size, owner)
    );
  }

  @callable()
  async close(path: string) {
    await fs.close(toAbsolutePath(this.state.cwd, path));
  }

  @callable()
  async chdir(path: string) {
    let newCwd = toAbsolutePath(this.state.cwd, path, true);
    const dir = await this.readdir({ path: newCwd });
    if (dir.length > 0) {
      // it exists
      this.setState({ ...this.state, cwd: newCwd });
      return newCwd;
    }
  }

  @callable({ streaming: true })
  async pipe(stream: StreamingResponse, call: keyof this, ...args: unknown[]) {
    try {
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
    } catch (e: any) {
      let utf8Encode = new TextEncoder();
      const errBytes = utf8Encode.encode(e.toString());
      stream.send(errBytes);
      stream.end();
    }
  }

  @callable()
  ps() {
    const procs: any = [];
    PROCS.forEach(({ cwd, task }, procId) => {
      procs.push({ procId, task, cwd });
    });
    return procs;
  }

  @callable()
  async kill(procId: string) {
    const proc = PROCS.get(procId);
    if (!proc || proc.aborted)
      return "Process doesn't exist or has already been aborted";
    PROCS.set(procId, { ...proc, aborted: true });
    await proc.promise;
  }

  @callable()
  async reboot() {
    // TODO: revisit
    this.setState(INITIAL_STATE);
    await this.destroy();
    return true;
  }

  @callable()
  async test() {
    publishToBus(EventType.Debug, "Test 1234 Hell yah rocking baby");
  }

  isUserOnline() {
    const conns = Array.from(this.getConnections());
    return !!conns.length;
  }

  async orchestrate(event: Event) {
    switch (event.type) {
      case EventType.FileCreated: {
        const { path } = event.data;
        this.log("info", `${path} created`, `system`);
        let error = null;
        await summarizeAndIndex(path, "files").catch((e) => (error = e));
        if (error)
          this.log(
            "error",
            `error computing summary for ${path}: ${error}`,
            `system`
          );
        else this.log("info", `indexed for ${path} created`, `system`);
        break;
      }
      case EventType.FileDeleted: {
        //TODO: delete embedds
        const { path } = event.data;
        this.log("info", `${path} deleted`, `system`);
        break;
      }
      case EventType.NewEmail: {
        const { path, userNotification } = event.data;
        this.log("mail", `${userNotification}. Stored in ${path}.`, `quorra`);
        let error = null;
        await summarizeAndIndex(path, "emails").catch((e) => (error = e));
        if (error)
          this.log(
            "error",
            `error computing summary for ${path}: ${error}`,
            `system`
          );
        else this.log("info", `indexed for ${path} created`, `system`);
        break;
      }
      case EventType.ProcessSpawned: {
        const { id, task } = event.data;
        this.log(
          "info",
          `Task spawned: <${task.slice(0, 16)}>...`,
          `proc:${id}`
        );
        break;
      }
      case EventType.ProcessAborted: {
        const { id, task } = event.data;
        this.log(
          "info",
          `Received abort signal. Aborting task <${task.slice(0, 16)}...>`,
          `proc:${id}`
        );
        break;
      }
      case EventType.ProcessFinished: {
        const { id, task } = event.data;
        this.log(
          "info",
          `Task completed successfully <${task.slice(0, 16)}...>`,
          `proc:${id}`
        );
        break;
      }
      default:
        console.log("boop");
    }
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

    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/www/")) {
      const b64Key = readCookieValue(request, "auth");
      if (!b64Key) return new Response("missing auth", { status: 400 });
      const key = atob(b64Key);
      if (key != env.SECRET_KEY) return new Response("gtfo", { status: 401 });

      if (url.pathname.startsWith("/www/")) {
        const [_, path] = url.pathname.split("/www/");
        const file = await env.FILE_SYSTEM.get(`/var/www/${path}`);
        if (file && file.body) return new Response(file.body);
        return new Response("not found", { status: 404 });
      }

      const namedAgent = getAgentByName<Env, Quorra>(env.Quorra, "quorra");
      const namedResp = (await namedAgent).fetch(request);
      return namedResp;
    }

    return Response.redirect(url.origin);
  },

  // Requires an Email Route to be set up to this worker.
  // I deployed the handler and that made it available in the CF Dashboard under Account > Zone > Email Routing.
  async email(message: ForwardableEmailMessage) {
    try {
      const quorra = await getAgentByName(env.Quorra, "quorra");
      const username = (await quorra.state).username;
      const email = await PostalMime.parse(message.raw);
      let conf = await readAsConfig<Partial<MailConf>>(MAIL_CONF_PATH);
      if (!conf)
        await quorra.log(
          "warn",
          `Processing email without a configuration file. Replies will only be logged, not delivered. Add it in ${MAIL_CONF_PATH}.`
        );
      const task = formatMailTask(conf, email);

      const deps = {
        email,
        quorraAddr: conf.quorra_addr ?? "quorrahasnoaddress@mail.com",
        reject: (str: string) => message.setReject(str),
        sendReply: async (from: string, to: string, content: string) => {
          const { EmailMessage } = await import("cloudflare:email");
          // creating EmailMessage from the Quorra DO breaks. Have to create it here.
          if (!conf?.quorra_addr) return;
          const replyMessage = new EmailMessage(from, to, content);
          await message.reply(replyMessage);
        },
      };

      // Model setup
      const modelsConf = await readAsConfig<Partial<ModelConfig>>(
        MODEL_CONF_PATH
      ).catch((e) => e.toString());
      const preferences = await readUserPreferences(username);
      const model = modelsConf?.models?.aliases?.[modelsConf?.models?.email];
      if (!model)
        notifyUser(
          `Fix your model config. [models].email not set or not found in ${MODEL_CONF_PATH}.`
        );
      let processes = [];
      for (const [id, { cwd, task }] of PROCS.entries()) {
        processes.push({ id, cwd, task });
      }
      const provider = new OpenAI(model.provider);
      const messages: any = [
        {
          role: "system",
          content: buildPrompt(
            username,
            await quorra.isUserOnline(),
            "/tmp/",
            JSON.stringify(processes),
            "Empty",
            preferences,
            "None"
          ),
        },
        { role: "user", content: task },
      ];
      const tools = getToolDefsByMode(Mode.Email);
      const callFunction = generateCallFunction(Mode.Email, deps);

      // Call model + exec tools
      await execWithTools({
        model: model.name,
        provider,
        messages,
        tools,
        callFunction,
        options: { toolChoice: "required" },
      });
    } catch (e: any) {
      if (!(e instanceof Error)) {
        e = new Error(e);
      }
      await notifyUser(`[EMAIL ERROR] ${e.name}: ${e.message}`);
    }
  },
  async queue(batch, env) {
    const quorra = await getAgentByName(env.Quorra, "quorra");
    for (const msg of batch.messages) {
      // do work
      await quorra.orchestrate(msg.body as Event);
      msg.ack(); // ack after success
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
