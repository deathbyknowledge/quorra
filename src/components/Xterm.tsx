import React, { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useAppContext } from "../context/AppContext";
import { commands, authCommands } from "../system/commands";
import { useAuthContext } from "../context/AuthContext";

const XtermComponent: React.FC = () => {
  const terminalRef = useRef(null);
  const termRef = useRef<any>(null);
  const inputBuffer = useRef("");
  const [history, setHistory] = useState<string[]>([]); // Command history
  const historyIndex = useRef<number>(-1); // Current position in history
  const ctx = useAppContext();
  const { key, setKey } = useAuthContext();
  const term = ctx.term;

  useEffect(() => {
    if (!term) return;

    termRef.current = term;
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    if (terminalRef.current) {
      term.open(terminalRef.current);
      term.focus();
      fitAddon.fit();

      const handleResize = () => fitAddon.fit();
      window.addEventListener("resize", handleResize);

      (terminalRef.current as any).focus();

      return () => {
        window.removeEventListener("resize", handleResize);
        term.dispose();
      };
    }
  }, [term]);

  useEffect(() => {
    if (!term) return;

    const lis = term.onData(async (data) => {
      if (data === "\r") {
        // Enter key
        const command = inputBuffer.current.trim();
        if (command) {
          setHistory((prev) => [command, ...prev]); // Add to history
          historyIndex.current = -1; // Reset history index
        }
        const [cmd, ...args] = command.split(" ");
        term.writeln("");
        if (!ctx.established || !key) {
          if (cmd in authCommands) authCommands[cmd](args, term, setKey as any);
        } else {
          if (cmd in commands) await commands[cmd](args, ctx);
        }
        inputBuffer.current = "";
        term.write(ctx.prompt.current);
      } else if (data === "\b" || data.charCodeAt(0) === 127) {
        // Backspace
        if (inputBuffer.current.length > 0) {
          inputBuffer.current = inputBuffer.current.slice(0, -1);
          term.write("\b \b");
        }
      } else if (data === "\t") {
        // Tab key
        const input = inputBuffer.current.trim();
        const availableCommands = {
          ...(ctx.established && key ? commands : authCommands),
        };
        const matches = Object.keys(availableCommands).filter((cmd) =>
          cmd.startsWith(input)
        );
        if (matches.length === 1) {
          inputBuffer.current = matches[0];
          term.write("\r" + ctx.prompt.current + inputBuffer.current);
        } else if (matches.length > 1) {
          term.writeln("");
          term.writeln(matches.join("\t"));
          term.write(ctx.prompt.current + inputBuffer.current);
        }
      } else if (data === "\x1b[A") {
        // Up arrow
        if (historyIndex.current < history.length - 1) {
          historyIndex.current++;
          inputBuffer.current = history[historyIndex.current];
          term.write("\r" + ctx.prompt.current + inputBuffer.current);
        }
      } else if (data === "\x1b[B") {
        // Down arrow
        if (historyIndex.current > -1) {
          historyIndex.current--;
          inputBuffer.current =
            historyIndex.current === -1 ? "" : history[historyIndex.current];
          term.write("\r" + ctx.prompt.current + inputBuffer.current);
        }
      } else if (data !== "\x1b[C" && data !== "\x1b[D") {
        // Ignore left/right arrows for now; handle other input
        inputBuffer.current += data;
        term.write(data);
      }
    });

    return () => lis.dispose();
  }, [term, ctx.agentState?.cwd, history]);

  return (
    <div
      ref={terminalRef}
      style={{
        height: "calc(100% - 20px)",
        minWidth: "100%",
        padding: "10px",
      }}
    />
  );
};

export default XtermComponent;
