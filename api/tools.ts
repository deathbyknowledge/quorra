import { zodFunction } from "openai/helpers/zod";
import { z } from "zod";
import { createMimeMessage } from "mimetext";
import { Email } from "postal-mime";
import { formatEmailAsString } from "./utils";
import { QUORRA_MAIL } from "./constants";

/*
    EMAIL TOOLS
*/
enum EmailTools {
  HandleEmail = "handleEmail",
  RejectEmail = "rejectEmail",
}

// Handle Email. Decides wether to store an incoming email and if to possibly reply to it.
const HandleEmailParameters = z
  .object({
    shouldStore: z.boolean().describe("Whether this email needs to be stored."),
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

const createHandleEmail = async (
  env: Env,
  email: Email,
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

  return async ({ shouldStore, reply }: HandleEmailParams) => {
    if (reply) {
      const msg = createMimeMessage();
      msg.setHeader("In-Reply-To", email.messageId);
      msg.setHeader("References", email.messageId); // also necessary for proper threading
      msg.setSender({
        name: "Quorra",
        addr: QUORRA_MAIL,
      });
      msg.setRecipient(email.from.address!);
      msg.setSubject(replySubject);
      msg.addMessage({
        contentType: "text/plain",
        data: reply,
      });

      await sendReply(QUORRA_MAIL, email.from.address!, msg.asRaw());
    }

    // TODO: remove `true` whenever we're ready for prod
    if (shouldStore || true) {
      const now = new Date();
      const id = crypto.randomUUID().slice(0, 8);
      const path = `/var/mail/${now.getUTCFullYear()}${now.getUTCMonth()}${now.getUTCDate()}_${id}.txt`;
      const formattedReply = reply
        ? `\n\n${formatEmailAsString(
            { address: QUORRA_MAIL, name: "Quorra" },
            replySubject,
            reply
          )}`
        : "";

      await env.FILE_SYSTEM.put(path, `${formattedEmail}${formattedReply}`);
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
  async (reject: (str: string) => void) =>
  ({ reason }: RejectEmailParams) => {
    reject(reason);
  };

//   {
//     type: "function",
//     function: {
//       name: "readdir",
//       description:
//         "Lists file system entries in the specified directory path. Returns JSON array of entries, either files or directories with their paths.",
//       parameters: {
//         type: "object",
//         properties: {
//           path: { type: "string" },
//         },
//         required: ["path"],
//       },
//     },
//   },

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
      return [];
    default:
      throw "Trying to get tools for an unsupported mode.";
  }
};

// I think I'm just making my life harder by not using a library for this but w/e
export const generateCallFunction = async (
  mode: Mode,
  args: unknown,
  env: Env
) => {
  switch (mode) {
    case Mode.Email:
      const { email, reject, sendReply } = args as {
        email: Email;
        reject: (reason: string) => void;
        sendReply: (from: string, to: string, content: string) => Promise<void>;
      };
      const handleEmail = await createHandleEmail(env, email, sendReply);
      const rejectEmail = await createRejectEmail(reject);
      return async (name: string, args: any) => {
        if (name === EmailTools.HandleEmail) {
          return await handleEmail(args);
        }
        if (name === EmailTools.RejectEmail) {
          return rejectEmail(args);
        }
      };
    case Mode.AllSyscalls:
      return (...args: any) => console.error("Unimplemented. Tried", args);
    default:
      throw "Trying to generate callFunction for an unsupported mode.";
  }
};

// I had to createa Bot and add it install it with my Discord user.
// I better write this down, otherwise I forget the steps I took.
export const notifyUser = async (message: string) => {
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
    console.error("Failed to send message");
    console.log(messageResponse.statusText);
  }
};
