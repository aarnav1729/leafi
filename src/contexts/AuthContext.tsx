// root/src/contexts/AuthContext.tsx
import React, { createContext, useContext, useState, useEffect } from "react";
import { toast } from "sonner";
import { AuthState, User, UserRole } from "@/types/auth.types";
import { setCredentials } from "@/lib/api";

interface AuthContextType extends AuthState {
  lastOtp?: string | null;
  requestOtp: (username: string) => Promise<boolean>;
  verifyOtp: (username: string, otp: string) => Promise<boolean>;
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
  requestOtp: async () => false,
  verifyOtp: async () => false,

  logout: () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [state, setState] = useState<AuthState>(initialState);
  const [lastOtp, setLastOtp] = useState<string | null>(null);

  // On mount, rehydrate user
  useEffect(() => {
    const stored = localStorage.getItem("rfq_user");
    const token = localStorage.getItem("rfq_session_token");

    if (stored && token) {
      const user = JSON.parse(stored) as User;
      setCredentials(user.username, token); // username=email, token=sessionToken
      setState({ isAuthenticated: true, user, isLoading: false, error: null });
    } else {
      setState({ ...initialState, isLoading: false });
    }
  }, []);

  const requestOtp = async (username: string): Promise<boolean> => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }), // no password => OTP request
      });
      if (!res.ok) throw new Error("Failed to send OTP");
      const data = await res.json().catch(() => null);
      const otp = data?.otp ? String(data.otp) : null;
      setLastOtp(otp);

      setState((s) => ({ ...s, isLoading: false, error: null }));
      toast.success(otp ? `OTP: ${otp}` : "OTP sent");

      return true;
    } catch (err: any) {
      setState((s) => ({
        ...s,
        isLoading: false,
        error: err.message || "OTP request failed",
      }));
      toast.error(err.message || "OTP request failed");
      return false;
    }
  };

  const verifyOtp = async (username: string, otp: string): Promise<boolean> => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: otp }), // OTP goes as "password" for now
      });
      if (!res.ok) {
        const msg = (await res.json().catch(() => null))?.message;
        throw new Error(msg || "Invalid OTP");
      }

      const data = await res.json();
      const user: User = data.user;
      const sessionToken: string = data.sessionToken;

      localStorage.setItem("rfq_user", JSON.stringify(user));
      localStorage.setItem("rfq_session_token", sessionToken);

      // Use BasicAuth everywhere: username + sessionToken
      setCredentials(username, sessionToken);

      setState({ isAuthenticated: true, user, isLoading: false, error: null });
      toast.success("Login successful");
      setLastOtp(null);

      return true;
    } catch (err: any) {
      setState((s) => ({
        ...s,
        isLoading: false,
        error: err.message || "Login failed",
      }));
      toast.error(err.message || "Login failed");
      return false;
    }
  };

  const logout = () => {
    localStorage.removeItem("rfq_user");
    localStorage.removeItem("rfq_session_token");
    setCredentials("", "");
    setState({
      isAuthenticated: false,
      user: null,
      isLoading: false,
      error: null,
    });
    toast.info("Logged out");
    setLastOtp(null);
  };

  return (
    <AuthContext.Provider
      value={{ ...state, lastOtp, requestOtp, verifyOtp, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
};
