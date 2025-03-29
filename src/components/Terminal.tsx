import React from "react";
import { useAppContext } from "../context/AppContext";
import LoadingBorderWrapper from "./LoadingBorderWrapper";
import XtermComponent from "./Xterm";

const Terminal: React.FC = () => {
  const {  loading, setLoading } =
    useAppContext();

  return (
    <LoadingBorderWrapper
      borderColor="var(--color-line)"
      animationSpeed={1}
      onFinish={() => {
        setLoading(false);
      }}
    >
      {!loading && <XtermComponent />}
    </LoadingBorderWrapper>
  );
};

export default Terminal;
