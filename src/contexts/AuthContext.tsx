// root/src/contexts/AuthContext.tsx
import React, { createContext, useContext, useState, useEffect } from "react";
import { toast } from "sonner";
import { AuthState, User, UserRole } from "@/types/auth.types";
import { setCredentials } from "@/lib/api";

interface AuthContextType extends AuthState {
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
}

const initialState: AuthState = {
  isAuthenticated: false,
  user: null,
  isLoading: true,
  error: null,
};

const AuthContext = createContext<AuthContextType>({
  ...initialState,
  login: async () => false,
  logout: () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [state, setState] = useState<AuthState>(initialState);

  // On mount, rehydrate user
  useEffect(() => {
    const stored = localStorage.getItem("rfq_user");
    if (stored) {
      const user = JSON.parse(stored) as User;
      setState({ isAuthenticated: true, user, isLoading: false, error: null });
      // Also restore credentials if you saved them in localStorage (optional)
    } else {
      setState({ ...initialState, isLoading: false });
    }
  }, []);

  const login = async (
    username: string,
    password: string
  ): Promise<boolean> => {
    setState({ ...state, isLoading: true, error: null });
    try {
      // Call the server
      const res = await fetch("http://10.0.50.16:3337/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) throw new Error("Invalid credentials");
      const user: User = await res.json();

      // 1) persist
      localStorage.setItem("rfq_user", JSON.stringify(user));
      // 2) configure API client
      setCredentials(username, password);

      setState({ isAuthenticated: true, user, isLoading: false, error: null });
      toast.success("Login successful");
      return true;
    } catch (err: any) {
      setState({
        ...state,
        isLoading: false,
        error: err.message || "Login failed",
      });
      toast.error(err.message || "Login failed");
      return false;
    }
  };

  const logout = () => {
    localStorage.removeItem("rfq_user");
    // clear axios auth
    setCredentials("", "");
    setState({ isAuthenticated: false, user: null, isLoading: false, error: null });
    toast.info("Logged out");
  };

  return (
    <AuthContext.Provider value={{ ...state, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};