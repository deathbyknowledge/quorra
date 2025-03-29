import React, { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import { useAppContext } from "../context/AppContext";

type CommandFn = (
  term: Terminal,
  inputBuffer: React.MutableRefObject<string>,
  agent: any
) => void | Promise<void>;

const writeMultiline = (term: Terminal, content: string) => {
  content.split("\n").forEach((line) => term.writeln(line));
};

const commands: { [key: string]: CommandFn } = {
  clear: (term, inputBuffer) => {
    term.write("", () => term.clear());
    inputBuffer.current = "";
  },
  whoami: (term, inputBuffer) => {
    term.writeln("sam"); // Move cursor to start of line
    inputBuffer.current = "";
  },

  ls: async (term, inputBuffer, _agent) => {
    const res = await (
      await fetch("/api/quorra", {
        method: "POST",
        body: JSON.stringify({ type: "cmd", data: inputBuffer.current }),
        headers: {
          "content-type": "application/json",
        },
      })
    ).json();
    let str = "";
    res.forEach((entry: FSEntry) => {
      const name = entry.path.split("/")[1];
      str += (entry.type === "file" ? name : `\x1b[1m${name}\x1b[0m`) + "\t";
    });
    term.writeln(str);
    inputBuffer.current = "";
  },
  cat: async (term, inputBuffer, _agent) => {
    const res = await await fetch("/api/quorra", {
      method: "POST",
      body: JSON.stringify({ type: "cmd", data: inputBuffer.current }),
      headers: {
        "content-type": "application/json",
      },
    });
    try {
      if (res.ok) {
        const contentStr = await res.text();
        writeMultiline(term, contentStr);
      } else {
        const { error } = await res.json();
        term.writeln(error);
      }
    } catch (e) {
      term.writeln("Binary blob file.");
    }
    inputBuffer.current = "";
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
  const { agent } = useAppContext();

  useEffect(() => {
    // Initialize xterm terminal
    const term = new Terminal({
      cursorBlink: true,
      theme: {
        background: "rgba(0, 0, 0, 0)", // Transparent background
        foreground: "#9baaa0",
        cursor: "#9baaa0",
      },
      // Remove fixed rows/cols to allow dynamic sizing
    });

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
          const [cmd] = inputBuffer.current.split(" ");
          if (cmd in commands) {
            term.writeln("");
            await commands[cmd](term, inputBuffer, agent);
            term.write("$ "); // Move cursor to start of line
          } else {
            term.write("\r\n$ ");
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
  }, []);

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
