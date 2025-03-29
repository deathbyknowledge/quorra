import React, { useEffect, useRef } from "react";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import { AppContext, useAppContext } from "../context/AppContext";

type CommandFn = (args: string[], ctx: AppContext) => void | Promise<void>;

const commands: { [key: string]: CommandFn } = {
  clear: (_, { term }) => {
    if (!term) return;
    term.write("", () => term.clear());
  },
  whoami: (_, { term }) => {
    if (!term) return;
    term.writeln("sam"); // Move cursor to start of line
  },
  ls: async (args, { agent, term }) => {
    if (!term || !agent) return;

    const res = await agent.call<FSEntry[]>("ls", [args]);
    let str = "";
    res.forEach((entry: FSEntry) => {
      const slugs = entry.path.split("/");
      const name =
        entry.path.split("/")[slugs.length - (entry.type === "file" ? 1 : 2)];
      str += (entry.type === "file" ? name : `\x1b[1m${name}\x1b[0m`) + "\t";
    });
    term.writeln(str);
  },
  cat: async (args, { agent, term }) => {
    if (!term || !agent) return;
    // convert to abs path
    await agent.call("cat", [args], {
      onChunk: (chunk: any) => {
        const arr = Uint8Array.from(Object.values(chunk));
        term.write(arr);
      },
      onDone: () => term.writeln(""),
    });
  },
};

export type FSEntry = {
  type: "file" | "dir";
  path: string;
  size?: number;
  ts?: Date;
};
const XtermComponent: React.FC = () => {
  const terminalRef = useRef(null);
  const termRef = useRef<any>(null); // To store terminal instance
  const inputBuffer = useRef(""); // Store current line input
  const ctx = useAppContext();
  const term = ctx.term;

  useEffect(() => {
    // Initialize xterm terminal
    if (!term) return;

    // Store terminal instance in ref
    termRef.current = term;

    // Initialize FitAddon
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    // Attach terminal to the ref div
    if (terminalRef.current) {
      term.open(terminalRef.current);

      // Fit terminal to container size
      fitAddon.fit();

      // Initial content
      term.write("$ ");

      // Handle user input
      term.onData(async (data) => {
        if (data === "\r") {
          // Enter key
          const [cmd, ...args] = inputBuffer.current.trim().split(" ");
          if (cmd in commands) {
            term.writeln("");
            await commands[cmd](args, ctx);
            inputBuffer.current = "";
            term.write("$ "); // Move cursor to start of line
          } else {
            term.write("\n$ ");
            inputBuffer.current = ""; // Reset buffer
          }
        } else if (data === "\b" || data.charCodeAt(0) === 127) {
          // Backspace
          if (inputBuffer.current.length > 0) {
            inputBuffer.current = inputBuffer.current.slice(0, -1); // Remove last char
            term.write("\b \b"); // Move cursor back, overwrite with space, move back again
          }
        } else {
          // Regular character
          inputBuffer.current += data;
          term.write(data);
        }
      });

      // Handle window resize
      const handleResize = () => {
        fitAddon.fit();
      };

      window.addEventListener("resize", handleResize);

      // Cleanup
      return () => {
        window.removeEventListener("resize", handleResize);
        term.dispose();
      };
    }
  }, [term]);

  return (
    <div
      ref={terminalRef}
      style={{
        height: "100%",
        minWidth: "100%",
        padding: "10px",
      }}
    />
  );
};

export default XtermComponent;
