import React, { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useAppContext } from "../context/AppContext";
import { commands } from "../system/commands";

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
      term.focus();

      // Fit terminal to container size
      fitAddon.fit();

      // Handle user input
      // Handle window resize
      const handleResize = () => {
        fitAddon.fit();
      };

      window.addEventListener("resize", handleResize);
      (terminalRef.current as any).focus();

      // Cleanup
      return () => {
        window.removeEventListener("resize", handleResize);
        term.dispose();
      };
    }
  }, [term]);

  useEffect(() => {
    if (!term) return;

    // if (disposable) disposable.dispose();
    const lis = term.onData(async (data) => {
      if (data === "\r") {
        // Enter key
        const [cmd, ...args] = inputBuffer.current.trim().split(" ");
        term.writeln("");
        if (cmd in commands) {
          await commands[cmd](args, ctx);
          inputBuffer.current = "";
        } else {
          inputBuffer.current = ""; // Reset buffer
        }
        term.write(ctx.prompt.current);
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
    return () => lis.dispose();
  }, [term, ctx.agentState?.cwd]);

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
