import { Address } from "postal-mime";
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
