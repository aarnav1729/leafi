
export type UserRole = 'logistics' | 'vendor';

export interface User {
  id: string;
  username: string;
  role: UserRole;
  name: string;
  company?: string;
}

export interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  isLoading: boolean;
  error: string | null;
}
