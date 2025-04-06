import React from "react";
import { useAppContext } from "../context/AppContext";
import LoadingBorderWrapper from "./LoadingBorderWrapper";
import XtermComponent from "./Xterm";
import { Header } from "./Header";

const Terminal: React.FC = () => {
  const { animationLoading, setAnimationLoading, setFilePath, editingFile } =
    useAppContext();
  console.log(setFilePath, editingFile);

  return (
    <div
      style={{
        width: `calc(${editingFile ? "45%" : "100%"} - 20px)`,
        height: "90%",
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
    </div>
  );
};

export default Terminal;
