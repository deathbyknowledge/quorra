import React, {
  createContext,
type   PropsWithChildren,
  useContext,
  useEffect,
  useState,
} from "react";

type AuthContext = {
  key?: string;
  setKey?: (token: string) => void;
};

const AuthContext = createContext<AuthContext>({});

// very simple auth context
export const AuthContextProvider: React.FC<PropsWithChildren> = ({
  children,
}) => {
  const [key, setKey]  = useState<string | undefined>();

  useEffect(() => {
    const authKey = localStorage.getItem("auth");
    if (authKey) {
      document.cookie = "auth=" + btoa(authKey) + "; path=/";
      setKey(authKey);
    }
  }, []);

  const setKeyInStg = (key: string) => {
    localStorage.setItem("auth", key);
    location.reload();
  };

  return (
    <AuthContext.Provider value={{ key: key, setKey: setKeyInStg }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuthContext = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw Error("AuthContext was undefined");
  return ctx;
};
