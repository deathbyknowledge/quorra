import React from "react";
import Terminal from "./components/Terminal";
import "./App.css";
import { ContextProvider, useAppContext } from "./context/AppContext";
import { AuthContextProvider } from "./context/AuthContext";
import { Editor } from "./components/Editor";
import { Header } from "./components/Header";
import LoadingBorderWrapper from "./components/LoadingBorderWrapper";

const EventFeed: React.FC = () => {
  const { events } = useAppContext();
  return (
    <div className="column event‑rail">
      <Header left="EVENTS" right="" />
      <LoadingBorderWrapper borderColor="var(--color-line)" borderWidth="1px">
        <ul className="event‑list">
          {events.map((ev) => (
            <li key={ev.ts} className={`ev-${ev.level}`}>
              <span className="ts">{new Date(ev.ts).toLocaleTimeString()}</span>
              <span className="msg">{ev.message}</span>
            </li>
          ))}
        </ul>
      </LoadingBorderWrapper>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <AuthContextProvider>
      <ContextProvider>
          <Editor />
          <Terminal />
          <EventFeed />
        </ContextProvider>
      </AuthContextProvider>
  );
};

export default App;
