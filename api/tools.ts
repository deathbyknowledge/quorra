import { zodFunction } from "openai/helpers/zod";
import { z } from "zod";
import { createMimeMessage } from "mimetext";
import { Email } from "postal-mime";
import { formatEmailAsString, notifyUser, toAbsolutePath } from "./utils";
import { env } from "cloudflare:workers";
import { fs } from "./fs";

/*
    EMAIL TOOLS
*/
enum EmailTools {
  HandleEmail = "handleEmail",
  RejectEmail = "rejectEmail",
}

enum SysTools {
  ReadDir = "readDirectory",
  ReadFile = "readFile",
  WriteFile = "writeFile",
}

enum SearchTools {
  WebSearch = "webSearch",
  ReadWebsites = "readWebsites",
}

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

const createWriteFile = (cwd?: string) => {
  return async ({ path, content }: WriteFileParams) => {
    path = toAbsolutePath(cwd ?? "/tmp/", path);
    return !!(await env.FILE_SYSTEM.put(path, content));
  };
};

const createReadFile = (cwd?: string) => {
  return async ({ path }: ReadFileParams) => {
    path = toAbsolutePath(cwd ?? "/tmp/", path);
    const obj = await env.FILE_SYSTEM.get(path);
    if (obj && obj.body) return await obj.text();
    return null;
  };
};

const createReadWebsites = () => {
  return async ({ url }: ReadWebsiteParams) => {
    const maxRetries = 3;
    let i = 0;
    while (true) {
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        const file = { name: url + ".html", blob };
        const parsed = await env.AI.toMarkdown(file);
        const result = `[START OF CONTENT FOR ${parsed.name.slice(0, -5)}]\n${
          parsed.data
        }\n[END OF CONTENT]\n`;
        return result;
      } catch {
        i++;
        if (maxRetries < i) return "Error: can't read the website.";
        continue;
      }
    }
  };
};

const createWebSearch = () => {
  return async ({ query }: WebSearchParams) => {
    const myHeaders = new Headers();
    myHeaders.append("X-API-KEY", process.env.SEARCH_KEY);
    myHeaders.append("Content-Type", "application/json");

    const raw = JSON.stringify({
      q: query,
    });

    const requestOptions = {
      method: "POST",
      headers: myHeaders,
      body: raw,
      redirect: "follow",
    };

    try {
      const response = await fetch(
        "https://google.serper.dev/search",
        requestOptions
      );
      const { searchParameters, knowledgeGraph, organic, topStories }: any =
        await response.json();
      const res = {
        searchParameters,
        knowledgeGraph,
        organic: organic?.slice(0, 3),
        topStories: topStories?.slice(0, 3),
      };
      return JSON.stringify(res, null, 2);
    } catch (error: any) {
      console.error(error.toString());
      return error.toString();
    }
  };
};

const createReadDir = (cwd?: string) => {
  return async ({ path }: ReadDirParams) => {
    path = toAbsolutePath(cwd ?? "/tmp/", path);
    return await fs.readdir({ path });
  };
};

// Handle Email. Decides wether to store an incoming email and if to possibly reply to it.
const HandleEmailParameters = z
  .object({
    shouldStore: z.boolean().describe("Whether this email needs to be stored."),
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
  .required({ shouldStore: true });

type HandleEmailParams = z.infer<typeof HandleEmailParameters>;

const handleEmailDef = zodFunction({
  name: EmailTools.HandleEmail,
  parameters: HandleEmailParameters,
  description: "Handles the email when it is NOT to be rejected.",
});

const createHandleEmail = (
  email: Email,
  quorraAddr: string,
  sendReply: (from: string, to: string, content: string) => Promise<void>
) => {
  const replySubject = email.subject?.startsWith("Re: ")
    ? email.subject
    : `Re: ${email.subject}`; // turns out this is pretty necessary if you want mail clients to thread properly

  const formattedEmail = formatEmailAsString(
    email.from,
    email.subject ?? "",
    email.text ?? email.html ?? ""
  );

  return async ({
    shouldStore,
    reply,
    userNotification,
  }: HandleEmailParams) => {
    // TODO: remove `true` whenever we're ready for prod
    if (shouldStore || true) {
      const now = new Date();
      var formattedDate; // MMMM`
      formattedDate = now.getFullYear() + '-' + ('0' + (now.getMonth()+1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2);
      

      const id = crypto.randomUUID().slice(0, 8);
      const path = `/var/mail/${formattedDate}/${id}.txt`;
      const formattedReply = reply
        ? `\n\n${formatEmailAsString(
            { address: quorraAddr, name: "Quorra" },
            replySubject,
            reply
          )}`
        : "";

      await env.FILE_SYSTEM.put(path, `${formattedEmail}${formattedReply}`);
    }
    if (reply) {
      const msg = createMimeMessage();
      msg.setHeader("In-Reply-To", email.messageId);
      msg.setHeader("References", email.messageId); // also necessary for proper threading
      msg.setSender({
        name: "Quorra",
        addr: quorraAddr,
      });
      msg.setRecipient(email.from.address!);
      msg.setSubject(replySubject);
      msg.addMessage({
        contentType: "text/plain",
        data: reply,
      });

      await sendReply(quorraAddr, email.from.address!, msg.asRaw());
      await notifyUser(userNotification);
    }
  };
};

// Reject Email. Have you ever sent an email to an address that doesn't exist?
// This triggers a similar error with a custom reason for the failed delivery.
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

const createRejectEmail =
  (reject: (str: string) => void) =>
  ({ reason }: RejectEmailParams) => {
    reject(reason);
  };

/*
   ✨ PUTTING IT ALL TOGETHER ✨
*/
export enum Mode {
  Email = "email",
  AllSyscalls = "allSyscalls",
}

export const getToolDefsByMode = (mode: Mode) => {
  switch (mode) {
    case Mode.Email:
      return [handleEmailDef, rejectEmailDef];
    case Mode.AllSyscalls:
      return [
        readDirDef,
        writeFileDef,
        readFileDef,
        webSearchDef,
        readWebsitesDef,
      ];
    default:
      throw "Trying to get tools for an unsupported mode.";
  }
};

// I think I'm just making my life harder by not using a library for this but w/e
export const generateCallFunction = (mode: Mode, args: unknown) => {
  switch (mode) {
    case Mode.Email: {
      const { email, reject, sendReply, quorraAddr } = args as {
        email: Email;
        quorraAddr: string;
        reject: (reason: string) => void;
        sendReply: (from: string, to: string, content: string) => Promise<void>;
      };
      const handleEmail = createHandleEmail(email, quorraAddr, sendReply);
      const rejectEmail = createRejectEmail(reject);
      return async (name: string, args: any) => {
        if (name === EmailTools.HandleEmail) {
          return await handleEmail(args);
        }
        if (name === EmailTools.RejectEmail) {
          return rejectEmail(args);
        }
      };
    }
    case Mode.AllSyscalls: {
      let cwd;
      if (args) cwd = (args as any).cwd;
      const readDir = createReadDir(cwd);
      const readFile = createReadFile(cwd);
      const writeFile = createWriteFile(cwd);
      const webSearch = createWebSearch();
      const readWebsites = createReadWebsites();
      return async (name: string, args: any) => {
        if (name === SysTools.ReadDir) {
          return await readDir(args);
        }
        if (name === SysTools.WriteFile) {
          return await writeFile(args);
        }
        if (name === SearchTools.WebSearch) {
          return await webSearch(args);
        }
        if (name === SearchTools.ReadWebsites) {
          return await readWebsites(args);
        }
        if (name === SysTools.ReadFile) {
          return await readFile(args);
        }
      };
    }
    default:
      throw "Trying to generate callFunction for an unsupported mode.";
  }
};
