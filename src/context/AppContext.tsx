import React, {
  createContext,
  type MutableRefObject,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAgent } from "agents/react";
import { Terminal } from "@xterm/xterm";
import { formatPrompt } from "../system/constants";
import { useAuthContext } from "./AuthContext";

export type AppContext = {
  animationLoading: boolean;
  setAnimationLoading: any;
  agent?: ReturnType<typeof useAgent<AgentState>>;
  agentState?: AgentState;
  established: boolean;
  editingFile?: string;
  setFilePath: (path: string) => void;
  term?: Terminal;
  prompt: MutableRefObject<string>;
  events: any[];
};

const AppContext = createContext<AppContext>({
  animationLoading: true,
  setAnimationLoading: () => {},
  setFilePath: () => {},
  established: false,
  prompt: {} as MutableRefObject<string>,
  events: [],
});

export type AgentState = {
  cwd: string;
  conversations: { from: string; content: string }[];
  flags: { debug: boolean };
  username: string;
};

export const ContextProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [animationLoading, setAnimationLoading] = useState(true);
  const [agentState, _setAgentState] = useState<AgentState | undefined>();
  const [established, setEstablished] = useState(false);
  const [filePath, setFilePath] = useState<string | undefined>();
  const [events, setEvents] = useState<any[]>([]);
  const { key } = useAuthContext();
  const prompt = useRef("$ ");
  const term = useMemo(() => {
    // First msg just empty prompt
    const dexTheme = {
      // base
      background: "#0D100E", // COLOR_15  - same as UI bg
      foreground: "#9BAAA0", // COLOR_175 - normal text
      cursor: "#768B7D", // COLOR_135 - subtle but visible
      selectionBackground: "rgba(82,104,92,.35)", // COLOR_95 w/ alpha

      // ANSI 0‑7 (dark) ----------------------------------------------------------------
      black: "#0D100E", // black   – matches bg so “black” text vanishes
      red: "#3A4A41", // red     – reused dark olive as we have no red
      green: "#2F3C35", // green   – COLOR_55
      yellow: "#52685C", // yellow  – COLOR_95
      blue: "#768B7D", // blue    – COLOR_135
      magenta: "#74A18D", // magenta – BrightC
      cyan: "#9BAAA0", // cyan    – COLOR_175
      white: "#CED4CF", // light   – computed: brighten COLOR_175

      // ANSI 8‑15 (bright) --------------------------------------------------------------
      brightBlack: "#202924", // COLOR_35  (subdued comments)
      brightRed: "#3A4A41", // same reuse
      brightGreen: "#3F594F", // mix COLOR_55 + COLOR_95
      brightYellow: "#768B7D", // COLOR_135
      brightBlue: "#9BAAA0", // COLOR_175
      brightMagenta: "#8BC3AB", // BrightC lightened
      brightCyan: "#D3E1DB", // very light mint
      brightWhite: "#FFFFFF",
    };
    const _term = new Terminal({
      cursorBlink: true,
      convertEol: true,
      theme: dexTheme,
      // theme: {
      //   background: "rgba(0, 0, 0, 0)", // Transparent background
      //   foreground: "#9baaa0",
      //   cursor: "#9baaa0",
      // },
    });
    _term.writeln("Booting up...");

    return _term;
  }, []);

  useEffect(() => {
    if (term && typeof key === "undefined")
      term.write(`Authorization required.\n${prompt.current}`);
  }, [term, typeof key === undefined]);

  const agent = useAgent({
    agent: "quorra",
    prefix: "api",
    onOpen: () => {
      setEstablished(true);
    },
    onStateUpdate: (_state) => {
      const state = _state as AgentState;
      _setAgentState((prev) => {
        if (typeof prev === "undefined") {
          // first state update since page load
          term.write(`\n${formatPrompt(state.cwd)}`, () => term.clear());
        }
        return state as AgentState;
      });
      prompt.current = formatPrompt(state.cwd);
    },
    onMessage: (msg) => {
      try {
        const { type, data } = JSON.parse(msg.data);
        if (type === "system-event") {
          setEvents((prev) => [...prev, data]);
        }
      } catch (e) {
        console.error(e);
      }
    },
    onClose: () => setEstablished(false),
  });

  return (
    <AppContext.Provider
      value={{
        agent,
        animationLoading,
        established,
        agentState,
        setAnimationLoading,
        setFilePath,
        editingFile: filePath,
        term,
        prompt,
        events,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw Error("AppContext was undefined");
  return ctx;
};
