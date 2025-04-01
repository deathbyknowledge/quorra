import React, {
  createContext,
  MutableRefObject,
  PropsWithChildren,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAgent } from "agents/react";
import { Terminal } from "@xterm/xterm";
import { formatPrompt } from "../system/constants";

export type AppContext = {
  animationLoading: boolean;
  setAnimationLoading: any;
  agent?: ReturnType<typeof useAgent<AgentState>>;
  agentState?: AgentState;
  messages: Message[];
  setMessages: any;
  term?: Terminal;
  prompt: MutableRefObject<string>;
};

const AppContext = createContext<AppContext>({
  animationLoading: true,
  setAnimationLoading: () => {},
  messages: [],
  setMessages: () => {},
  prompt: {} as MutableRefObject<string>,
});

export type AgentState = {
  cwd: string;
};

interface Message {
  role: "user" | "assistant";
  content: string;
}

export const ContextProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [animationLoading, setAnimationLoading] = useState(true);
  const [agentState, _setAgentState] = useState<AgentState | undefined>();
  const [messages, setMessages] = useState<Message[]>([]);
  const prompt = useRef("/$ ");
  const term = useMemo(() => {
    // First msg just empty prompt
    if (!agentState) return;

    const _term = new Terminal({
      cursorBlink: true,
      convertEol: true,
      theme: {
        background: "rgba(0, 0, 0, 0)", // Transparent background
        foreground: "#9baaa0",
        cursor: "#9baaa0",
      },
    });
    prompt.current = formatPrompt(agentState.cwd);
    _term.write(prompt.current);

    return _term;
  }, [typeof agentState === "undefined"]);

  const agent = useAgent({
    agent: "quorra",
    prefix: "api",
    onOpen: () => {},
    onStateUpdate: _setAgentState,
    onMessage: (message) => {
      try {
        const { type, data } = JSON.parse(message.data);
        if (type === "cli") {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                typeof data === "string" ? data : JSON.stringify(data, null, 2),
            },
          ]);
        }
      } catch (error) {
        console.error("Error processing WebSocket message:", error);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "Error: Could not process server response.",
          },
        ]);
      }
    },
  });

  return (
    <AppContext.Provider
      value={{
        agent,
        animationLoading,
        agentState,
        messages,
        setMessages,
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
