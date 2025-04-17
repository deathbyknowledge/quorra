import { env } from "cloudflare:workers";
import { readAsConfig } from "./tools";
import { type ModelConfig, notifyUser } from "./utils";
import { MODEL_CONF_PATH } from "./constants";
import OpenAI from "openai";
export enum EventType {
  FileCreated,
  FileDeleted,
  ProcessSpawned,
  ProcessFinished,
  ProcessAborted,
  NewEmail,
  Debug,
}

export type Event = {
  type: EventType;
  data: any;
};

export type FileCreatedPayload = {
  path: string;
};

export async function publishToBus(type: EventType, data: any) {
  await env.BUS.send({ type, data });
}

export async function summary(
  path: string,
  type: "emails" | "files" | "conversations"
) {
  const obj = await env.FILE_SYSTEM.get(path);
  if (!obj || !obj.body) throw new Error("File Create doesn't exist?");

  const content = await obj.text();

  const modelsConf = await readAsConfig<Partial<ModelConfig>>(
    MODEL_CONF_PATH
  ).catch<Partial<ModelConfig>>((e) => e.toString());
  const model = modelsConf?.models?.aliases?.[modelsConf?.models?.summary];
  if (!model) {
    notifyUser(
      `Fix your model config. [models].summary not set or not found in ${MODEL_CONF_PATH}.`
    );
    return;
  }
  const provider = new OpenAI(model?.provider);
  const messages: any = [
    {
      role: "system",
      content:
        "You are a language summary expert. You are to condense and describe the text provided so it can be indexed by a RAG model. Highly detailed and expressive. Output is not for humans but LLMs. Do not use human formalities.",
    },
    { role: "user", content: content },
  ];
  const result = await provider.chat.completions.create({
    model: model.name,
    messages,
  });
  const summary = result.choices[0].message.content;
  const res = await env.AI.run("@cf/baai/bge-large-en-v1.5", {
    text: summary!,
  });
  await env.VECTORIZE.insert([
    { id: path, values: res.data[0], namespace: type },
  ]);
}
