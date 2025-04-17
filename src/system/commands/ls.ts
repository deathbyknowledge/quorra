import commandLineArgs, {
  type OptionDefinition,
} from "../../libs/command-line-args";
import {stdout} from "../constants";
import type { CommandFn, FSEntry } from "../types";

export const options: OptionDefinition[] = [
  { name: "path", defaultOption: true },
  { name: "long", alias: "l", defaultValue: false, type: Boolean },
  { name: "all", alias: "a", defaultValue: false, type: Boolean },
];

const parseOwner = (owner: string, username: string) =>
  owner === "user" ? username : owner;
// Function to format timestamp like ls -l
function formatTimestamp(date: Date) {
  date = new Date(date);
  const now = new Date();
  const sixMonthsAgo = new Date(now.valueOf() - 6 * 30 * 24 * 60 * 60 * 1000); // Rough 6 months in ms

  const month = date.toLocaleString("en-US", { month: "short" });
  const day = String(date.getDate()).padStart(2, " "); // Pad with space, not 0
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  if (date > sixMonthsAgo) {
    // Recent: show time (e.g., "Apr  3 14:35")
    return `${month} ${day} ${hours}:${minutes}`;
  } else {
    // Older: show year (e.g., "Apr  3  2024")
    return `${month} ${day} ${year}`;
  }
}

const parseName = (entry: FSEntry) => {
  const parts = entry.path.split("/");
  return parts[parts.length - (entry.type === "file" ? 1 : 2)];
};

export const ls: CommandFn = async (argv, { agent, term, agentState }) => {
  // this is terrible
  if (!term || !agent || !agentState) return;
  let { path, all, long } = commandLineArgs(options, { argv });
  if (!path) {
    path = agentState?.cwd ?? "/";
  }
  if (!path.endsWith("/")) path += "/";

  const dirEntries = await agent.call<FSEntry[]>("readdir", [{ path }]);
  const colWidths = {
    owner: Math.max(
      ...dirEntries.map(
        (e) => parseOwner(e.owner ?? "user", agentState.username).length
      )
    ),
    size: Math.max(...dirEntries.map((e) => String(e.size ?? "-").length)),
    ts: Math.max(
      ...dirEntries.map((e) => (e.ts ? formatTimestamp(e.ts) : "-").length)
    ),
    name: Math.max(...dirEntries.map((e) => parseName(e).length)),
  };
  if (long) {
    dirEntries.forEach((entry: FSEntry) => {
      const name = parseName(entry);
      const owner = parseOwner(entry.owner ?? "user", agentState?.username);
      if (!all && name.startsWith(".")) return;
      const formattedTime = entry.ts ? formatTimestamp(entry.ts) : "-";
      const line = [
        owner.padEnd(colWidths.owner, " "),
        String(entry.size ?? "-").padStart(colWidths.size, " "),
        formattedTime.padEnd(colWidths.ts, " "),
        entry.type === "file" ? name : `\x1b[1m${name}`,
      ].join("  ");
      term.writeln(stdout(line));
    });
  } else {
    let str = "";
    dirEntries.forEach((entry: FSEntry) => {
      const name = parseName(entry);
      if (!all && name.startsWith(".")) return;
      str += (entry.type === "file" ? name : `\x1b[1m${name}`) + "\t";
    });
    term.writeln(stdout(str));
  }
};
