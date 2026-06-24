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
  patchAuthProfile,
  postAuthLogin,
  postAuthLogout,
  postAuthRegister,
  type UpdateProfileInput,
} from "./api";
import { setAuthToken } from "./http";

type AuthContextValue = {
  user: AuthUser | null;
  authLoading: boolean;
  authReady: boolean;
  sessionBusy: boolean;
  sessionAction: "login" | "logout" | "register" | null;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (u: AuthUser | null) => void;
  updateDisplayName: (name: string) => Promise<void>;
  updateProfile: (input: UpdateProfileInput) => Promise<void>;
  updateTheme: (theme: "dark" | "light") => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authReady, setAuthReady] = useState(false);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionAction, setSessionAction] = useState<"login" | "logout" | "register" | null>(null);

  const refresh = useCallback(async () => {
    setAuthReady(false);
    try {
      const { user: u } = await fetchAuthMe();
      if (!u) setAuthToken(null);
      setUser(u);
    } finally {
      setAuthReady(true);
    }
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
    setSessionAction("login");
    setSessionBusy(true);
    try {
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
    } finally {
      setSessionBusy(false);
      setSessionAction(null);
    }
  }, []);

  const register = useCallback(async (email: string, password: string, displayName?: string) => {
    setSessionAction("register");
    setSessionBusy(true);
    try {
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
    } finally {
      setSessionBusy(false);
      setSessionAction(null);
    }
  }, []);

  const logout = useCallback(async () => {
    setSessionAction("logout");
    setSessionBusy(true);
    try {
      try {
        await postAuthLogout();
      } finally {
        setAuthToken(null);
        setUser(null);
      }
    } finally {
      setSessionBusy(false);
      setSessionAction(null);
    }
  }, []);

  const updateDisplayName = useCallback(async (name: string) => {
    const u = await patchAuthDisplayName(name);
    setUser(u);
  }, []);

  const updateProfile = useCallback(async (input: UpdateProfileInput) => {
    const u = await patchAuthProfile(input);
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
      authReady,
      sessionBusy,
      sessionAction,
      refresh,
      login,
      register,
      logout,
      setUser,
      updateDisplayName,
      updateProfile,
      updateTheme,
    }),
    [user, authLoading, authReady, sessionBusy, sessionAction, refresh, login, register, logout, updateDisplayName, updateProfile, updateTheme]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
