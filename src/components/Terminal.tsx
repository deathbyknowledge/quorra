import React from "react";
import { useAppContext } from "../context/AppContext";
import LoadingBorderWrapper from "./LoadingBorderWrapper";
import XtermComponent from "./Xterm";
import { Header } from "./Header";
import Keyboard from "./Keyboard";

const Terminal: React.FC = () => {
  const { animationLoading, setAnimationLoading, editingFile } =
    useAppContext();

  return (
    <div
      className="column"
      style={{
        width: `calc(${editingFile ? "45%" : "100%"} - 20px)`,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: "20px",
      }}
    >
      <Header left="TERMINAL" right="MAIN" />
      <LoadingBorderWrapper
        borderColor="#9baaa0"
        borderWidth="2px"
        animationSpeed={1}
      >
        <div className="app-container">
          <LoadingBorderWrapper
            borderColor="var(--color-line)"
            animationSpeed={1}
            onFinish={() => {
              setAnimationLoading(false);
            }}
          >
            {!animationLoading ? (
              <XtermComponent />
            ) : (
              <div
                style={{
                  height: "100%",
                  minWidth: "100%",
                  padding: "10px",
                }}
              />
            )}
          </LoadingBorderWrapper>
        </div>
      </LoadingBorderWrapper>
      <div style={{display: "flex", justifyContent: "center"}}>
      <Keyboard />
      </div>
    </div>
  );
};

export default Terminal;
