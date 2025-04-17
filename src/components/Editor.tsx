import { type Monaco } from "@monaco-editor/react";
import MonacoEditor from "@monaco-editor/react";
import React, { useEffect, useRef, useState } from "react";
import LoadingBorderWrapper from "./LoadingBorderWrapper";
import { useAppContext } from "../context/AppContext";
import { type FSEntry } from "../system/types";
import "../App.css";
import { Header } from "./Header";

export const Editor: React.FC = () => {
  const { editingFile: filePath, agent } = useAppContext();
  const [fileContent, setFileContent] = useState(""); // Initial content
  const editorRef: any = useRef(null); // To store the Monaco Editor instance
  const [loading, setLoading] = useState(true);

  // Set up the editor instance and add keybindings
  const handleEditorDidMount = (editor: any, monaco: Monaco) => {
    editorRef.current = editor;

    // Add a keybinding for Ctrl+S (or Cmd+S on macOS) to save
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveFile();
    });
  };

  useEffect(() => {
    const loadContent = async () => {
      let str = "";
      let utf8decoder = new TextDecoder(); // default 'utf-8' or 'utf8'
      if (filePath && agent) {
        await agent.call("pipe", ["readfile", filePath], {
          onChunk: (chunk: any) => {
            str += utf8decoder.decode(Uint8Array.from(Object.values(chunk)));
          },
          onDone: () => loadFileContent(str),
          //   onError: (e) => term.writeln(`Error: ${e}`),
        });
      }
      if (!filePath) setLoading(true);
    };
    loadContent();
  }, [filePath]);

  // Set the content of the editor (e.g., load a file)
  const loadFileContent = (content: string) => {
    setFileContent(content);
    if (editorRef.current) {
      editorRef.current.setValue(content);
    }
  };

  const saveFile = async () => {
    if (editorRef.current && agent) {
      const content: string = editorRef.current.getValue();
      try {
        const encoder = new TextEncoder();
        await agent.call<FSEntry>("open", [filePath, content.length]);
        let total = 0;
        const chunkSize = 1024 * 16; // 16KB
        while (content.length > total) {
          const chunk = content.slice(total, total + chunkSize);
          await agent.call<FSEntry>("writefile", [
            filePath,
            encoder.encode(chunk),
          ]);
          total += chunkSize;
        }
        await agent.call<FSEntry>("close", [filePath]);
        console.log("File saved to server successfully!");
      } catch (error) {
        console.error("Error saving file:", error);
      }
    }
  };

  const handleEditorWillMount = (monaco: Monaco) => {
    // Define a custom theme to match the terminal
    monaco.editor.defineTheme("terminalTheme", {
      base: "vs-dark", // Start with a dark base
      inherit: true, // Inherit defaults, override only what we need
      rules: [
        // Minimal syntax highlighting (or none)
        { token: "", foreground: "9baaa0" }, // All text is light gray, like the terminal
        { token: "comment", foreground: "9baaa0" }, // No special color for comments
        { token: "keyword", foreground: "9baaa0" }, // No special color for keywords
        { token: "string", foreground: "9baaa0" }, // No special color for strings
        // Add more tokens if you want slight variations, or keep them all the same
      ],
      colors: {
        // Core editor styling to match the terminal
        "editor.background": "#0d100e", // Pure black background
        "editor.foreground": "#9baaa0", // Light gray text
        "editor.lineHighlightBackground": "#0d100e", // Very subtle line highlight (dark gray)
        "editor.lineHighlightBorder": "#0d100e", // No border for line highlight
        // Gutter (line numbers area)
        "editorGutter.background": "#0d100e", // Black gutter to blend in
        "editorLineNumber.foreground": "#9baaa0", // Darker gray for line numbers
        "editorLineNumber.activeForeground": "#9baaa0", // Active line number matches text
        // Remove unnecessary UI elements
        "editorCursor.foreground": "#9baaa0", // Light gray cursor
        "editor.selectionBackground": "#333333", // Subtle selection background
        "editor.selectionForeground": "#9baaa0", // Keep text readable on selection
        "editor.inactiveSelectionBackground": "#222222", // Even subtler inactive selection
        // Scrollbar and shadows
        "scrollbarSlider.background": "#333333", // Subtle scrollbar
        "scrollbarSlider.hoverBackground": "#444444", // Slightly lighter on hover
        "scrollbarSlider.activeBackground": "#555555", // Slightly lighter when active
        "editor.shadow": "#00000000", // No shadow
        "scrollbar.shadow": "#00000000", // No scrollbar shadow
      },
    });
  };
  return filePath ? (
    <div
      className="column"
      style={{
        width: "55%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: "20px",
      }}
    >
      <Header left="LINE" right={filePath} />
      <LoadingBorderWrapper
        borderColor="#9baaa0"
        borderWidth="2px"
        animationSpeed={1}
      >
        <div className="app-container">
          <LoadingBorderWrapper
            borderColor="var(--color-line)"
            borderWidth="1px"
            animationSpeed={1}
            onFinish={() => setLoading(false)}
          >
            <div
              style={{
                height: "100%",
                width: "100%",
                background: "var(--background)",
              }}
            >
              {!loading && (
                <MonacoEditor
                  height="100%"
                  width="100%"
                  defaultLanguage="text" // Or "bash" if you're editing shell scripts
                  defaultValue={fileContent}
                  theme="terminalTheme" // Apply the custom theme
                  beforeMount={handleEditorWillMount} // Define theme before editor mounts
                  onMount={handleEditorDidMount}
                  options={{
                    // Match the terminal's minimalism
                    minimap: { enabled: false }, // No minimap
                    scrollBeyondLastLine: false, // No extra scroll space
                    fontSize: 15, // Typical terminal font size
                    fontWeight: "bold",
                    fontFamily: "'Courier New', monospace", // Monospaced font like a terminal
                    lineNumbers: "on", // Keep line numbers, but minimal
                    wordWrap: "on",
                    folding: false, // No code folding
                    renderLineHighlight: "line", // Subtle line highlight
                    renderWhitespace: "none", // No whitespace markers
                    glyphMargin: false, // No glyph margin
                    overviewRulerLanes: 0, // No overview ruler
                    hideCursorInOverviewRuler: true, // No cursor in overview
                    scrollbar: {
                      vertical: "visible",
                      horizontal: "visible",
                      useShadows: false, // No shadows on scrollbars
                    },
                  }}
                />
              )}
            </div>
          </LoadingBorderWrapper>
        </div>
      </LoadingBorderWrapper>
    </div>
  ) : (
    <div />
  );
};
