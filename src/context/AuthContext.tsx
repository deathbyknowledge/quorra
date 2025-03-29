import React, {
  createContext,
  PropsWithChildren,
  useContext,
  useEffect,
  useState,
} from "react";

type AuthContext = {
  CF_TOKEN?: string;
  setToken?: (token: string) => void;
};

const AuthContext = createContext<AuthContext>({});

export const AuthContextProvider: React.FC<PropsWithChildren> = ({
  children,
}) => {
  const [cfToken, setCfToken] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("auth");
    if (token) {
      document.cookie = "X-Auth=" + token + "; path=/";
      setCfToken(token);
    }
  }, []);

  const setToken = (token: string) => {
    localStorage.setItem("auth", token);
  };

  return (
    <AuthContext.Provider value={{ CF_TOKEN: cfToken, setToken }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuthContext = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw Error("AuthContext was undefined");
  return ctx;
};
