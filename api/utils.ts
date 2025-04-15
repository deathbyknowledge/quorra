import { Address, Email } from "postal-mime";
import {
  HERMES_THINK_PROMPT,
  HERMES_TOOL_PROMPT,
  QUORRA_PROMPT,
} from "./constants";
import OpenAI from "openai";
import {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
} from "openai/resources/index.mjs";

export enum Model {
  DeepHermes24B = "DeepHermes-3-Mistral-24B-Preview",
  Hermes70B = "Hermes-3-Llama-3.1-70B",
  GPT4o = "gpt-4o-2024-11-20",
  GPT4mini = "gpt-4o-mini",
  GPTo3 = "gpt-o3-mini",
  DeepSeekV3 = "deepseek-chat",
  DeepSeekR1 = "deepseek-reasoner",
  Llama4 = "@cf/meta/llama-4-scout-17b-16e-instruct",
}
const cfBaseUrl = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/v1`;

export enum ProviderURL {
  OpenAI = "https://api.openai.com/v1",
  Nous = "https://inference-api.nousresearch.com/v1",
  DeepSeek = "https://api.deepseek.com/v1",
}

export type ModelInfo = {
  name: string;
  provider: {
    baseURL: string;
    apiKey: string;
  };
  model_params: string;
};

export type ModelConfig = {
  models: {
    aliases: Record<string, ModelInfo>;
    default: string;
    email: string;
    autonomous_action: string;
    autonomous_reasoning: string;
  };
};

export const getModelSystemPrompt = (model: Model) => {
  switch (model) {
    case Model.DeepHermes24B:
      return HERMES_THINK_PROMPT;
    case Model.Hermes70B:
      return HERMES_TOOL_PROMPT;

    case Model.Llama4:
    case Model.GPT4o:
    case Model.DeepSeekV3:
    case Model.DeepSeekR1:
      return QUORRA_PROMPT;

    default:
      throw `What model is this? ${model}`;
  }
};

export function getActionPrompt(
  goal: string,
  scratchpad: string,
  plan: string
) {
  return `[START OF SYSTEM MESSAGE]
You are an autonomous agent's execution component.
Your task is to interpret the provided plan step and select the single, most appropriate tool call to execute it, using one of the available tools.
You MUST choose one tool and generate its arguments based *only* on the instruction in PLAN.md.
If PLAN.md contains "- Tool: START", "- Start", or is empty/irrelevant, you must analyze GOAL.md and SCRATCHPAD.md to determine the very *first* logical step for the task and formulate the tool call for that initial step.
Output *only* the tool call required to perform the action described in PLAN.md (or the initial action if PLAN.md is "- Tool: START"). Do not add any explanation or surrounding text.
[END OF SYSTEM MESSAGE]

[USER MESSAGE]
Current Task State:

--- GOAL.md ---
${goal}
--- END GOAL.md ---

--- SCRATCHPAD.md ---
${scratchpad}
--- END SCRATCHPAD.md ---

--- PLAN.md ---
${plan}
--- END PLAN.md ---

Select the appropriate tool call now based *only* on PLAN.md (or determine the initial step if PLAN.md is "- Tool: START").`;
}

export const buildPrompt = (username: string, status: boolean, cwd: string, processes: string, memory: string, preferences: string, conversation: string) => `
You are Quorra, ${username}'s personal agent. You live inside their computer system. ${username} can be ONSITE or AFK.
You manage the entire system. You have access to the file system and are free to read/write files as you see fit.
You have
You may also receive incoming traffic from external sources wishing to communicate or interact with ${username}. You must validate and are free to execute validated actions.
You MUST prioritize ${username}'s benefit on every single decision you make.

# LIVE SYSTEM INFORMATION
USER STATUS: ${status ? 'ONSITE' : 'AFK'}
CWD: ${cwd}
BUSY WORKER PROCESSES: ${processes}
MEMORY: ${memory}
USER PREFERENCES: ${preferences}
LAST CONVERSATION: ${conversation}

# SYSTEM MODULES
## FILE SYSTEM
You have read/write access to the all of the user's file system. NEVER assume the contents, structure or format of a file. If writing a file that already exists, always read first before writing to avoid data loss.
Its structure is the following:
- \`/var/mail/[YYYY-MM-DD]/[mail_id].txt\` is where you'll find individual emails.
- \`/var/www/\` is the servides files folder. All files and folders here are accessible to the user via https://quora.deathbyknowledge.com/www/[path inside /var/www/].
- \`/etc/\` is the configuration files folder. Currently only \`mail.conf\` and \`models.conf\` are implemented.
- \`/home/${username}/\` is the users home folder.
- \`/proc/[procId]/\` is a given process folders. Includes GOAL.md with the process goal, SCRATCHPAD.md with its working memory and PLAN.md with the upcoming instruction of the process.

## INTERNET ACCESS
Several internet features are available.
- Web Search: You can make a query on a search engine and browse the results.
- Read Websites: You can read the contents of a web page given a URL.
- \`fetch\`: JavaScript's fetch function. You can call it with the same parameters you would call it on the browser.

## QUORRA-ONLY MODULES
There are resources on the system that are purely managed by you and not the user. You must operate them exquisitly.
- Worker Processes: Worker instantiations of your program. You can spawn processes or kill them as you see fit. You can split a complex goal into smaller sub-tasks and delegate the sub-tasks to worker instances.
- System Goals: ${username} can directly request information that is not immediately avaialable, request a new system goal (an action to be performed until completion) or perhaps an external request requires work. You are to mantain and manage to completion all system goals by optimally scheduling Worker Processes. Already completed goasts must be updated.

# Input Types
When you are instantiated, you might be instantiated for one of the following reasons:
- Routine System Maintenance. No external nor user input. Happens every 1 minute. Look at the system information, processes and goals and decide whether any action is needed.
- ${username} Message: Direct message. Source might be CLI, email, direct message or other. Always adhere to ${username}'s message over any other instruction.
- External Traffic: External signals that made it to the system. Can be an email sent to ${username}, HTTP request from an outsider trying to communicate, etc.`

export function getReasoningPrompt(
  goal: string,
  scratchpad: string,
  plan: string,
  toolCalls: { name: string; args: string }[],
  toolResults: { name: string; result: string }[]
) {
  return `[START OF SYSTEM MESSAGE]
You are an autonomous agent's reasoning and planning component.
Your task is to analyze the result of the action that was just executed.
Based on the action's result, the overall goal, and the previous state:
1.  Write an analysis and reasoning update for the scratchpad. Explain the outcome, its relevance to the goal, and your thought process for the next step.
2.  Determine the *single, concrete next action* needed to progress towards the goal. This will be the new plan.
3.  Assess if the overall goal (defined in GOAL.md) has now been fully achieved.

You MUST output ONLY a single, valid JSON object adhering to this structure:
{
  "scratchpad_update": "string", // Markdown text with your analysis, observations, and reasoning for the next step.
  "next_plan": "string", // The single next action step (e.g., '- Tool: readFile, Path: \"output.txt\"' or '- Tool: FINISH')
  "is_complete": boolean // true if the overall GOAL is achieved, otherwise false.
}

If the goal is complete, set \`is_complete\` to true and \`next_plan\` should be "- Tool: FINISH".
If the action resulted in an error, analyze the error in \`scratchpad_update\` and plan an appropriate next step (e.g., retry, alternative, or give up with "- Tool: FINISH").
Do NOT include any text outside the JSON object.

Available tool names for planning: readFile, writeFile, readDir, webSearch, readWebsite, FINISH.
[END OF SYSTEM MESSAGE]

[USER MESSAGE]
Analyze the following execution context:

--- GOAL.md ---
${goal}
--- END GOAL.md ---

--- SCRATCHPAD.md (State *before* the action was executed) ---
${scratchpad}
--- END SCRATCHPAD.md (State *before* the action was executed) ---

--- Executed Plan Step (The action that was just run) ---
${plan}
--- END Executed Plan Step ---

--- Executed Tool Calls ---
${toolCalls
  .map((call) => `Tool Name: ${call.name}\nArguments: ${call.args}\n`)
  .join("\n")}
--- END Executed Tool Calls ---

--- Tool Execution Results ---
${toolResults
  .map((res) => `Tool Name: ${res.name}\nResult: ${res.result}\n`)
  .join("\n")}
{toolResultJsonString}
--- END Tool Execution Results ---

Generate the JSON output containing \`scratchpad_update\`, \`next_plan\`, and \`is_complete\` based on your analysis of the Tool Execution Result in the context of the GOAL.`;
}

export const getProviderConfig = (model: Model) => {
  switch (model) {
    case Model.DeepHermes24B:
    case Model.Hermes70B:
      return { baseURL: ProviderURL.Nous, apiKey: process.env.NOUS_KEY };

    case Model.GPT4o:
      return { baseURL: ProviderURL.OpenAI, apiKey: process.env.OPENAI_KEY };

    case Model.Llama4:
      return { baseURL: cfBaseUrl, apiKey: process.env.CF_TOKEN };

    case Model.DeepSeekV3:
    case Model.DeepSeekR1:
      return {
        baseURL: ProviderURL.DeepSeek,
        apiKey: process.env.DEEPSEEK_KEY,
      };

    default:
      throw `What model is this? ${model}`;
  }
};

export const formatEmailAsString = (
  from: Address,
  subject: string,
  content: string
) => `
FROM: [${from.name} (${from.address})]
SUBJECT: ${subject}
CONTENT:
${content}`;

// I had to createa Bot and install it with my Discord user.
// I better write this down, otherwise I forget the steps I take.
export const notifyUser = async (message: string, block = true) => {
  if (!process.env.QUORRA_DISCORD_TOKEN || !process.env.DISCORD_USER_ID) return;

  // Send a DM to the hardcoded user ID via Discord API
  const response = await fetch(
    `https://discord.com/api/v10/users/@me/channels`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${process.env.QUORRA_DISCORD_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipient_id: process.env.DISCORD_USER_ID,
      }),
    }
  );

  if (!response.ok) {
    throw new Error("Failed to create DM channel");
  }

  const channelData: any = await response.json();
  const channelId = channelData.id;

  // Send the message to the DM channel
  let read = 0;
  const max = 1800;
  while (read < message.length) {
    const messageResponse = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${process.env.QUORRA_DISCORD_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: block
            ? "```\n" + message.slice(read, read + max) + "\n```"
            : message.slice(read, read + max),
        }),
      }
    );

    if (!messageResponse.ok) {
      console.error("Failed to send message", messageResponse.statusText);
      console.error(await messageResponse.text());
      break;
    }
    read += max;
  }
};

export type MailConf = {
  preamble: string;
  filters: string[];
  quorra_addr: string; // requires external setup
};

export const formatMailTask = (
  conf: Partial<MailConf>,
  email: Email
): string => {
  let str = '<message source="external-email">\n<user_preamble>';
  if (conf.preamble) str += conf.preamble;
  if (conf.filters && conf.filters.length > 0) {
    str += "\n<filters>\n";
    for (const filter of conf.filters) {
      str += `\n<filter>\n${filter}\n</filter>\n`;
    }
    str += "</filters>\n";
  }
  if (conf.quorra_addr)
    str += `\nAny reply you decide to send will be sent from your own address, ${conf.quorra_addr}. Always sign your emails.\n`;

  str += '</user_preamble>';
  let formattedEmail = formatEmailAsString(
    email.from,
    email.subject ?? "",
    email.text ?? email.html ?? ""
  );
  formattedEmail = formattedEmail.replace(/<\/?email>/g, ""); // prompt injection dilligence 🧘‍♂️

  str += `<email>\n${formattedEmail}\n</email></message>`;
  return str;
};

export function toAbsolutePath(cwd: string, path: string, dir = false) {
  // TODO: start adding tests bc im going insane
  let effectivePath: string;

  if (path.startsWith("/")) {
    effectivePath = path;
  } else {
    cwd = cwd.endsWith("/") ? cwd : cwd + "/";
    effectivePath = cwd + path;
  }

  const segments = effectivePath.split("/");
  const resolvedSegments: string[] = [];

  for (const segment of segments) {
    if (segment === "" || segment === ".") {
      continue;
    } else if (segment === "..") {
      if (resolvedSegments.length > 0) {
        resolvedSegments.pop();
      }
    } else {
      resolvedSegments.push(segment);
    }
  }

  let finalPath = "/" + resolvedSegments.join("/");

  if (dir && finalPath !== "/" && !finalPath.endsWith("/")) {
    finalPath += "/";
  }

  return finalPath;
}

type ExectWithToolsParams = {
  model: string;
  provider: OpenAI;
  messages: ChatCompletionMessageParam[];
  tools: ChatCompletionTool[];
  callFunction: (name: string, args: any) => any;
  options?: {
    toolChoice?: ChatCompletionToolChoiceOption;
    temp?: number;
    topP?: number;
    maxTokens?: number;
  };
};

export const execWithTools = async ({
  model,
  provider,
  messages,
  tools,
  callFunction,
  options,
}: ExectWithToolsParams) => {
  const { toolChoice, maxTokens, temp, topP } = options ?? {};
  const response = await provider.chat.completions.create({
    model,
    tools,
    messages,
    temperature: temp,
    top_p: topP,
    tool_choice: toolChoice ?? "auto",
    max_tokens: maxTokens ?? 2048,
  });
  const result = response.choices[0].message;
  if (result.tool_calls && result.tool_calls.length > 0) {
    const toolCalls = result.tool_calls.map(async (toolCall) => {
      const name = toolCall.function.name;
      const args = toolCall.function.arguments;
      console.log(name, args);
      const toolResponse = await callFunction(name, JSON.parse(args));
      console.log(toolResponse);
      return {
        call: toolCall,
        result: toolResponse,
      };
    });
    return await Promise.all(toolCalls);
  } else {
    return result.content;
  }
};
