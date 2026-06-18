import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AuthUser } from "./api";
import {
  fetchAuthMe,
  patchAuthDisplayName,
  patchAuthMe,
  postAuthLogin,
  postAuthLogout,
  postAuthRegister,
} from "./api";
import { setAuthToken } from "./http";

type AuthContextValue = {
  user: AuthUser | null;
  authLoading: boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (u: AuthUser | null) => void;
  updateDisplayName: (name: string) => Promise<void>;
  updateTheme: (theme: "dark" | "light") => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { user: u } = await fetchAuthMe();
    if (!u) setAuthToken(null);
    setUser(u);
  }, []);

  useEffect(() => {
    void refresh().finally(() => setAuthLoading(false));
  }, [refresh]);

  useEffect(() => {
    if (!user || user.themePreference === "dark") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", "light");
    }
  }, [user]);

  const login = useCallback(async (email: string, password: string) => {
    const { user: signedIn, token } = await postAuthLogin(email, password);
    setAuthToken(token);
    setUser(signedIn);
    const { user: verified } = await fetchAuthMe();
    if (!verified) {
      setAuthToken(null);
      setUser(null);
      throw new Error("Sign-in succeeded but the session could not be verified. Please try again.");
    }
    setUser(verified);
  }, []);

  const register = useCallback(async (email: string, password: string, displayName?: string) => {
    const { user: created, token } = await postAuthRegister(email, password, displayName);
    setAuthToken(token);
    setUser(created);
    const { user: verified } = await fetchAuthMe();
    if (!verified) {
      setAuthToken(null);
      setUser(null);
      throw new Error("Account created but the session could not be verified. Please sign in.");
    }
    setUser(verified);
  }, []);

  const logout = useCallback(async () => {
    try {
      await postAuthLogout();
    } finally {
      setAuthToken(null);
      setUser(null);
    }
  }, []);

  const updateDisplayName = useCallback(async (name: string) => {
    const u = await patchAuthDisplayName(name);
    setUser(u);
  }, []);

  const updateTheme = useCallback(async (theme: "dark" | "light") => {
    const u = await patchAuthMe({ theme });
    setUser(u);
  }, []);

  const value = useMemo(
    () => ({
      user,
      authLoading,
      refresh,
      login,
      register,
      logout,
      setUser,
      updateDisplayName,
      updateTheme,
    }),
    [user, authLoading, refresh, login, register, logout, updateDisplayName, updateTheme]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
