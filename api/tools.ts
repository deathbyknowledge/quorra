import { zodFunction } from "openai/helpers/zod";
import { z } from "zod";
import { createMimeMessage } from "mimetext";
import { type Email } from "postal-mime";
import { parse } from "toml";
import { env } from "cloudflare:workers";

import { fs } from "./fs";
import { formatEmailAsString, toAbsolutePath } from "./utils";
import { EventType, publishToBus } from "./bus";

// Enums for tool names and modes
export enum EmailTools {
  HandleEmail = "handleEmail",
  RejectEmail = "rejectEmail",
}

export enum SysTools {
  ReadDir = "readDirectory",
  ReadFile = "readFile",
  WriteFile = "writeFile",
  QuerySystem = "querySystem",
}

export enum SearchTools {
  WebSearch = "webSearch",
  ReadWebsites = "readWebsites",
}

export enum Mode {
  Email = "email",
  AllSyscalls = "allSyscalls",
}

// Configuration readers
export async function readAsConfig<T>(path: string): Promise<T> {
  const obj = await env.FILE_SYSTEM.get(path);
  if (!obj?.body) {
    throw new Error("Quorra configuration file not found.");
  }
  const content = await obj.text();
  return parse(content) as T;
}

export async function readUserPreferences(username: string): Promise<string> {
  const obj = await env.FILE_SYSTEM.get(`/home/${username}/.quorra`);
  if (!obj?.body) {
    throw new Error("Quorra configuration file not found.");
  }
  return obj.text();
}

// Zod schemas and definitions for system calls
const WriteFileParameters = z
  .object({
    path: z
      .string()
      .describe(
        "Path of the file to write to disk. Must end with the file name."
      ),
    content: z.string().describe("Contents of the file to save."),
  })
  .required({ path: true, content: true });

export type WriteFileParams = z.infer<typeof WriteFileParameters>;

const writeFileDef = zodFunction({
  name: SysTools.WriteFile,
  parameters: WriteFileParameters,
  description:
    "Writes contents of a file to disk. If it already existed, it overrides the content. Returns a boolean with success status.",
});

const ReadFileParameters = z
  .object({
    path: z.string().describe("Path of the file to read."),
  })
  .required({ path: true });

export type ReadFileParams = z.infer<typeof ReadFileParameters>;

const readFileDef = zodFunction({
  name: SysTools.ReadFile,
  parameters: ReadFileParameters,
  description:
    "Reads the contents of the file at the given path. Returns null if the file doesn't exist.",
});

const ReadDirParameters = z
  .object({
    path: z.string().describe("The path of the directory to list."),
  })
  .required({ path: true });

export type ReadDirParams = z.infer<typeof ReadDirParameters>;

const readDirDef = zodFunction({
  name: SysTools.ReadDir,
  parameters: ReadDirParameters,
  description: "Lists the file system entries of the directory specified.",
});

const QuerySystemParameters = z
  .object({
    query: z
      .string()
      .describe(
        "The path of the directory to list. The queries can be in natural language as the search is powered by RAG."
      ),
    scope: z
      .enum(["files", "emails", "conversations", "all"])
      .describe("Type of data to query on the system. Defaults to 'all'."),
  })
  .required({ query: true });

export type QuerySystemParams = z.infer<typeof QuerySystemParameters>;

const querySystemDef = zodFunction({
  name: SysTools.QuerySystem,
  parameters: QuerySystemParameters,
  description:
    "Queries the system data. Can narrow the scope of the search for better accuracy. Returns top 3 results with the path of the source and the score of each match.",
});

// Zod schemas and definitions for web search
const WebSearchParameters = z
  .object({
    query: z.string().describe("A query to look up on the search engine."),
  })
  .required({ query: true });

export type WebSearchParams = z.infer<typeof WebSearchParameters>;

const webSearchDef = zodFunction({
  name: SearchTools.WebSearch,
  parameters: WebSearchParameters,
  description:
    "Looks up a query on a search engine. Shows ranked results with metadata, links, summaries, etc.",
});

const ReadWebsitesParameters = z
  .object({
    url: z.string().describe("The URL of the web page to be read."),
  })
  .required({ url: true });

export type ReadWebsiteParams = z.infer<typeof ReadWebsitesParameters>;

const readWebsitesDef = zodFunction({
  name: SearchTools.ReadWebsites,
  parameters: ReadWebsitesParameters,
  description: "Returns the content of a website.",
});

// Zod schemas and definitions for email tools
const HandleEmailParameters = z
  .object({
    userNotification: z
      .string()
      .describe(
        "Message to send the user to notify them of the new email. Short and descriptive."
      ),
    reply: z
      .string()
      .optional()
      .describe(
        "Optional field for the reply. When unset, no reply will be sent."
      ),
  })
  .required({ userNotification: true });

type HandleEmailParams = z.infer<typeof HandleEmailParameters>;

const handleEmailDef = zodFunction({
  name: EmailTools.HandleEmail,
  parameters: HandleEmailParameters,
  description: "Handles the email when it is NOT to be rejected.",
});

const RejectEmailParameters = z
  .object({
    reason: z
      .string()
      .describe(
        "The reason to give the sending client of why their email was rejected. Be based."
      ),
  })
  .required({ reason: true });

type RejectEmailParams = z.infer<typeof RejectEmailParameters>;

const rejectEmailDef = zodFunction({
  name: EmailTools.RejectEmail,
  parameters: RejectEmailParameters,
  description:
    "Rejects the email with the given reason. The user will not receive it.",
});

// Factory functions for tool implementations
const createWriteFile =
  (cwd?: string) =>
  async ({ path, content }: WriteFileParams) => {
    path = toAbsolutePath(cwd ?? "/tmp/", path);
    return !!(await env.FILE_SYSTEM.put(path, content));
  };

const createReadFile =
  (cwd?: string) =>
  async ({ path }: ReadFileParams) => {
    path = toAbsolutePath(cwd ?? "/tmp/", path);
    const obj = await env.FILE_SYSTEM.get(path);
    return obj?.body ? obj.text() : null;
  };

const createReadDir =
  (cwd?: string) =>
  async ({ path }: ReadDirParams) => {
    path = toAbsolutePath(cwd ?? "/tmp/", path, true);
    return fs.readdir({ path });
  };

const createQuerySystem =
  () =>
  async ({ query, scope = "all" }: QuerySystemParams) => {
    const res = await env.AI.run("@cf/baai/bge-large-en-v1.5", {
      text: query,
    });
    const namespace = scope === "all" ? undefined : scope;
    const results = await env.VECTORIZE.query(res.data[0], {
      namespace,
      topK: 3,
      returnMetadata: "none",
      returnValues: false,
    });

    return results.matches.map((match) => ({
      path: match.id,
      score: match.score,
    }));
  };

const createWebSearch =
  () =>
  async ({ query }: WebSearchParams) => {
    const headers = new Headers({
      "X-API-KEY": process.env.SEARCH_KEY || "",
      "Content-Type": "application/json",
    });
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers,
      body: JSON.stringify({ q: query }),
      redirect: "follow",
    });
    const data: any = await response.json();
    const { searchParameters, knowledgeGraph, organic, topStories } = data;
    return JSON.stringify(
      {
        searchParameters,
        knowledgeGraph,
        organic: organic?.slice(0, 3),
        topStories: topStories?.slice(0, 3),
      },
      null,
      2
    );
  };

const createReadWebsites =
  () =>
  async ({ url }: ReadWebsiteParams) => {
    const maxRetries = 3;
    for (let i = 0; i < maxRetries; i++) {
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        const file = { name: `${url}.html`, blob };
        const parsed = await env.AI.toMarkdown(file);
        return `[START OF CONTENT FOR ${parsed.name.slice(0, -5)}]\n${
          parsed.data
        }\n[END OF CONTENT]\n`;
      } catch {
        if (i === maxRetries - 1) return "Error: can't read the website.";
      }
    }
    return "Error: can't read the website.";
  };

const createHandleEmail = (
  email: Email,
  quorraAddr: string,
  sendReply: (from: string, to: string, content: string) => Promise<void>
) => {
  const replySubject = email.subject?.startsWith("Re: ")
    ? email.subject
    : `Re: ${email.subject}`;
  const formattedEmail = formatEmailAsString(
    email.from,
    email.subject ?? "",
    email.text ?? email.html ?? ""
  );

  return async ({ reply, userNotification }: HandleEmailParams) => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const id = crypto.randomUUID().slice(0, 8);
    const path = `/var/mail/${yyyy}-${mm}-${dd}/${id}.txt`;

    const formattedReply = reply
      ? `\n\n${formatEmailAsString(
          { name: "Quorra", address: quorraAddr },
          replySubject,
          reply
        )}`
      : "";

    await env.FILE_SYSTEM.put(path, `${formattedEmail}${formattedReply}`);
    await publishToBus(EventType.NewEmail, { path, userNotification });

    if (reply) {
      const msg = createMimeMessage();
      msg.setHeader("In-Reply-To", email.messageId);
      msg.setHeader("References", email.messageId);
      msg.setSender({ name: "Quorra", addr: quorraAddr });
      msg.setRecipient(email.from.address!);
      msg.setSubject(replySubject);
      msg.addMessage({ contentType: "text/plain", data: reply });
      await sendReply(quorraAddr, email.from.address!, msg.asRaw());
    }
  };
};

const createRejectEmail =
  (reject: (reason: string) => void) =>
  ({ reason }: RejectEmailParams) => {
    reject(reason);
  };

// Tool definition exports
export const getToolDefsByMode = (mode: Mode) => {
  switch (mode) {
    case Mode.Email:
      return [handleEmailDef, rejectEmailDef];
    case Mode.AllSyscalls:
      return [
        readDirDef,
        writeFileDef,
        readFileDef,
        querySystemDef,
        webSearchDef,
        readWebsitesDef,
      ];
    default:
      throw new Error("Unsupported mode: " + mode);
  }
};

export const generateCallFunction = (mode: Mode, args: unknown) => {
  switch (mode) {
    case Mode.Email: {
      const { email, quorraAddr, reject, sendReply } = args as any;
      const handleEmail = createHandleEmail(email, quorraAddr, sendReply);
      const rejectEmail = createRejectEmail(reject);
      return async (name: string, params: any) => {
        if (name === EmailTools.HandleEmail) return handleEmail(params);
        if (name === EmailTools.RejectEmail) return rejectEmail(params);
      };
    }
    case Mode.AllSyscalls: {
      const cwd = (args as any)?.cwd;
      const readDir = createReadDir(cwd);
      const readFile = createReadFile(cwd);
      const writeFile = createWriteFile(cwd);
      const querySystem = createQuerySystem();
      const webSearch = createWebSearch();
      const readWebsites = createReadWebsites();
      return async (name: string, params: any) => {
        switch (name) {
          case SysTools.ReadDir:
            return readDir(params);
          case SysTools.WriteFile:
            return writeFile(params);
          case SysTools.ReadFile:
            return readFile(params);
          case SysTools.QuerySystem:
            return querySystem(params);
          case SearchTools.WebSearch:
            return webSearch(params);
          case SearchTools.ReadWebsites:
            return readWebsites(params);
        }
      };
    }
    default:
      throw new Error("Unsupported mode: " + mode);
  }
};
