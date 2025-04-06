import { Address, Email } from "postal-mime";
import {
  HERMES_THINK_PROMPT,
  HERMES_TOOL_PROMPT,
  QUORRA_PROMPT,
} from "./constants";

export enum Model {
  DeepHermes24B = "DeepHermes-3-Mistral-24B-Preview",
  Hermes70B = "Hermes-3-Llama-3.1-70B",
  GPT4o = "gpt-4o-2024-11-20",
  DeepSeekV3 = "deepseek-chat",
}

export enum ProviderURL {
  OpenAI = "https://api.openai.com/v1",
  Nous = "https://inference-api.nousresearch.com/v1",
  DeepSeek = "https://api.deepseek.com/v1",
}

export const getModelSystemPrompt = (model: Model) => {
  switch (model) {
    case Model.DeepHermes24B:
      return HERMES_THINK_PROMPT;
    case Model.Hermes70B:
      return HERMES_TOOL_PROMPT;

    case Model.GPT4o:
    case Model.DeepSeekV3:
      return QUORRA_PROMPT;

    default:
      throw `What model is this? ${model}`;
  }
};

export const getProviderConfig = (model: Model) => {
  switch (model) {
    case Model.DeepHermes24B:
    case Model.Hermes70B:
      return { baseURL: ProviderURL.Nous, apiKey: process.env.NOUS_KEY };

    case Model.GPT4o:
      return { baseURL: ProviderURL.OpenAI, apiKey: process.env.OPENAI_KEY };

    case Model.DeepSeekV3:
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
export const notifyUser = async (message: string) => {
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
  const messageResponse = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bot ${process.env.QUORRA_DISCORD_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: message,
      }),
    }
  );

  if (!messageResponse.ok) {
    console.error("Failed to send message", messageResponse.statusText);
    console.error(await messageResponse.text());
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
  let str = "";
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

  let formattedEmail = formatEmailAsString(
    email.from,
    email.subject ?? "",
    email.text ?? email.html ?? ""
  );
  formattedEmail = formattedEmail.replace(/<\/?email>/g, ""); // prompt injection dilligence 🧘‍♂️

  str += `<email>\n${formattedEmail}\n</email>`;
  return str;
};
