import React, {
  createContext,
  PropsWithChildren,
  useContext,
  useMemo,
  useState,
} from "react";
import { useAgent } from "agents/react";
import { Terminal } from "xterm";

export type AppContext = {
  animationLoading: boolean;
  setAnimationLoading: any;
  agent?: ReturnType<typeof useAgent<AgentState>>;
  agentState?: AgentState;
  messages: Message[];
  setMessages: any;
  term?: Terminal,
};

const AppContext = createContext<AppContext>({
  animationLoading: true,
  setAnimationLoading: () => {},
  messages: [],
  setMessages: () => {},
});

type AgentState = {
  history: string[];
  env: Map<string, string>;
  HELP_MESSAGE: string;
  status: "ready" | "thinking" | "fetching";
};

interface Message {
  role: "user" | "assistant";
  content: string;
}

export const ContextProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [animationLoading, setAnimationLoading] = useState(true);
  const [agentState, _setAgentState] = useState<AgentState | undefined>();
  const [messages, setMessages] = useState<Message[]>([]);
  const term = useMemo(
    () =>
      new Terminal({
        cursorBlink: true,
        convertEol: true,
        theme: {
          background: "rgba(0, 0, 0, 0)", // Transparent background
          foreground: "#9baaa0",
          cursor: "#9baaa0",
        },
      }),
    []
  );

  const agent = useAgent({
    agent: "quorra",
    prefix: "api",
    onOpen: () => {
      //setMessages([{ role: "assistant", content: WELCOME_MESSAGE }]);
      agent.call("", [], {});
    },
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
