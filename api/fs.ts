import { env } from "cloudflare:workers";
import { FSEntry, Owner } from ".";

const openFileDescriptors = new Map<string, WritableStream>();

export const fs = {
  readfile,
  readdir: async ({ path }: { path: string }): Promise<FSEntry[]> => {
    const list = await env.FILE_SYSTEM.list({
      prefix: path, // must be already valid absolute path
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
  },
  writefile: async (path: string, data: any) => {
    const writer = openFileDescriptors.get(path)?.getWriter();
    if (!writer) return null;

    await writer.write(Uint8Array.from(Object.values(data)));
    writer.releaseLock();
  },
  unlink: async (paths: string[]) => {
    await env.FILE_SYSTEM.delete(paths);
  },
  stat: async (path: string) => {
    const obj = await env.FILE_SYSTEM.head(path);
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
  },
  open: (path: string, size: number, owner: string) => {
    // get file desc
    const { readable, writable } = new FixedLengthStream(size);
    openFileDescriptors.set(path, writable);
    const uploadPromise = env.FILE_SYSTEM.put(path, readable, {
      customMetadata: { owner },
    });

    return (async () => {
      try {
        await uploadPromise;
      } catch (e: any) {
        if (!(e instanceof Error)) {
          e = new Error(e);
        }
        console.error(`-- DURING OPEN --${e.name}: ${e.message}`);
      } finally {
        openFileDescriptors.delete(path); // ensure this is removed even if the upload fails
      }
    })();
  },
  close: async (path: string) => {
    const stream = openFileDescriptors.get(path);
    if (!stream) return;
    await stream.close();
    openFileDescriptors.delete(path);
  },
};

async function readfile(path: string, stream?: false): Promise<string | null>;
async function readfile(
  path: string,
  stream: true
): Promise<ReadableStream | null>;
async function readfile(
  path: string,
  stream = false
): Promise<ReadableStream | string | null> {
  const obj = await env.FILE_SYSTEM.get(path);
  if (!obj || !obj.body) {
    return null;
  }

  return stream ? obj.body : obj.text();
}
