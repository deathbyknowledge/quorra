import React, {
  createContext,
  MutableRefObject,
  PropsWithChildren,
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
  term?: Terminal;
  prompt: MutableRefObject<string>;
};

const AppContext = createContext<AppContext>({
  animationLoading: true,
  setAnimationLoading: () => {},
  established: false,
  prompt: {} as MutableRefObject<string>,
});

export type AgentState = {
  cwd: string;
};

export const ContextProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [animationLoading, setAnimationLoading] = useState(true);
  const [agentState, _setAgentState] = useState<AgentState | undefined>();
  const [established, setEstablished] = useState(false);
  const { key } = useAuthContext();
  const prompt = useRef("$ ");
  const term = useMemo(() => {
    // First msg just empty prompt
    const _term = new Terminal({
      cursorBlink: true,
      convertEol: true,
      theme: {
        background: "rgba(0, 0, 0, 0)", // Transparent background
        foreground: "#9baaa0",
        cursor: "#9baaa0",
      },
    });
    _term.writeln("Booting up...");

    return _term;
  }, []);

  useEffect(() => {
    if (term && !key)
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
        term,
        prompt,
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
