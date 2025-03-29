import React, {
  createContext,
  PropsWithChildren,
  useContext,
  useState,
} from "react";
import { useAgent } from "agents/react";

type AppContext = {
  loading: boolean;
  agent?: ReturnType<typeof useAgent<AgentState>>;
  agentState?: AgentState;
  messages: Message[];
  setMessages: any;
  setLoading: any;
};

const AppContext = createContext<AppContext>({
  loading: true,
  agent: undefined,
  messages: [],
  setMessages: () => {},
  setLoading: () => {},
});

type AgentState = {
  history: string[];
  env: Map<string, string>;
  HELP_MESSAGE: string,
  status: 'ready' | 'thinking' | 'fetching'
};

interface Message {
  role: "user" | "assistant";
  content: string;
}

export const ContextProvider: React.FC<PropsWithChildren> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [agentState, _setAgentState] = useState<AgentState | undefined>();
  const [messages, setMessages] = useState<Message[]>([]);

  const agent = useAgent({
    agent: "quorra",
    prefix: "api",
    onOpen: () => {
      //setMessages([{ role: "assistant", content: WELCOME_MESSAGE }]);
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
      value={{ agent, loading, agentState, messages, setMessages, setLoading }}
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
