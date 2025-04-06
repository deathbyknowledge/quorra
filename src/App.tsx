import React from "react";
import Terminal from "./components/Terminal";
import "./App.css";
import { ContextProvider } from "./context/AppContext";
import { AuthContextProvider } from "./context/AuthContext";
import {Editor} from "./components/Editor";

const App: React.FC = () => {
  return (
    <AuthContextProvider>
      <ContextProvider>
        <Editor />
        <Terminal />
      </ContextProvider>
    </AuthContextProvider>
  );
};

export default App;
