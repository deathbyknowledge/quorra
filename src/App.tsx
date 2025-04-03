import React from "react";
import Terminal from "./components/Terminal";
import { Header } from "./components/Header";
import "./App.css";
import { ContextProvider } from "./context/AppContext";
import LoadingBorderWrapper from "./components/LoadingBorderWrapper";
import { AuthContextProvider } from "./context/AuthContext";

const App: React.FC = () => {
  return (
    <AuthContextProvider>
      <ContextProvider>
        <div className="column">
          <Header left="SYSTEM" right="ALT PANEL"/>
        </div>
        <div
          style={{
            width: "70%",
            height: "90%",
            display: "flex",
            marginRight: "auto",
            marginLeft: "auto",
            flexDirection: "column",
            gap: "20px"
          }}
        >
          <Header left="TERMINAL" right="MAIN"/>
          <LoadingBorderWrapper
            borderColor="#9baaa0"
            borderWidth="2px"
            animationSpeed={1}
          >
            <div className="app-container">
              <Terminal />
            </div>
          </LoadingBorderWrapper>
        </div>
        <div className="column">
          <Header left="NETWORK" right="ALT PANEL"/>
        </div>
      </ContextProvider>
    </AuthContextProvider>
  );
};

export default App;
