
import React, { createContext, useContext, useState, useEffect } from "react";
import { toast } from "sonner";
import { AuthState, User, UserRole } from "@/types/auth.types";

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
  children 
}) => {
  const [state, setState] = useState<AuthState>(initialState);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const userData = localStorage.getItem("rfq_user");
        if (userData) {
          const user = JSON.parse(userData);
          setState({
            isAuthenticated: true,
            user,
            isLoading: false,
            error: null,
          });
        } else {
          setState({
            ...initialState,
            isLoading: false,
          });
        }
      } catch (error) {
        setState({
          ...initialState,
          isLoading: false,
          error: "Authentication error",
        });
      }
    };

    checkAuth();
  }, []);

  const login = async (username: string, password: string): Promise<boolean> => {
    setState({ ...state, isLoading: true, error: null });
    
    // Hardcoded credentials for demonstration
    let user: User | null = null;
    
    if (username === "aarnav" && password === "aarnav1729") {
      user = {
        id: "1",
        username: "aarnav",
        role: "logistics" as UserRole,
        name: "Aarnav",
      };
    } else if (username === "nav" && password === "nav") {
      user = {
        id: "2",
        username: "nav",
        role: "vendor" as UserRole,
        name: "Nav",
        company: "LEAFI"
      };
    } else if (username === "aarnav" && password === "aarnav") {
      user = {
        id: "3",
        username: "aarnav",
        role: "admin" as UserRole,
        name: "Aarnav (Admin)",
      };
    }

    if (user) {
      localStorage.setItem("rfq_user", JSON.stringify(user));
      setState({
        isAuthenticated: true,
        user,
        isLoading: false,
        error: null,
      });
      toast.success("Login successful");
      return true;
    } else {
      setState({
        ...state,
        isLoading: false,
        error: "Invalid credentials",
      });
      toast.error("Invalid credentials");
      return false;
    }
  };

  const logout = () => {
    localStorage.removeItem("rfq_user");
    setState({
      isAuthenticated: false,
      user: null,
      isLoading: false,
      error: null,
    });
    toast.info("Logged out");
  };

  return (
    <AuthContext.Provider value={{ ...state, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
