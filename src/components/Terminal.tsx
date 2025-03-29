import React from "react";
import { useAppContext } from "../context/AppContext";
import LoadingBorderWrapper from "./LoadingBorderWrapper";
import XtermComponent from "./Xterm";

const Terminal: React.FC = () => {
  const {  animationLoading, setAnimationLoading } =
    useAppContext();

  return (
    <LoadingBorderWrapper
      borderColor="var(--color-line)"
      animationSpeed={1}
      onFinish={() => {
        setAnimationLoading(false);
      }}
    >
      {!animationLoading && <XtermComponent />}
    </LoadingBorderWrapper>
  );
};

export default Terminal;
