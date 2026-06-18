import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AuthError, ProfileError } from "../api";
import { useAuth } from "../AuthContext";

const ALPHABET_NAME = /^[A-Za-z\s]*$/;

function filterAlphabetName(raw: string): string {
  return raw
    .split("")
    .filter((ch) => /[A-Za-z\s]/.test(ch))
    .join("");
}

function HoverRevealPassword({
  value,
  onChange,
  autoComplete,
}: {
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <input
      type={revealed ? "text" : "password"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onMouseEnter={() => setRevealed(true)}
      onMouseLeave={() => setRevealed(false)}
      autoComplete={autoComplete}
    />
  );
}

function IconSun() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconMoon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Modal({
  title,
  children,
  onClose,
  allowBackdropClose = true,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  allowBackdropClose?: boolean;
}) {
  return (
    <div
      role="dialog"
      aria-modal
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "grid",
        placeItems: "center",
        zIndex: 80,
        padding: 16,
      }}
      onMouseDown={(e) => {
        if (allowBackdropClose && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "min(400px, 100%)",
          background: "var(--bg1)",
          border: "1px solid var(--stroke)",
          borderRadius: 18,
          padding: "1.25rem",
          boxShadow: "var(--shadow)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 17, fontWeight: 650 }}>{title}</div>
          {allowBackdropClose && (
            <button type="button" className="btn-ghost" style={{ padding: "6px 10px" }} onClick={onClose}>
              Close
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

function avatarLetter(user: { displayName: string; email: string } | null): string {
  if (!user) return "?";
  const s = user.displayName.trim() || user.email;
  return s.charAt(0).toUpperCase();
}

export function UserAccountMenu() {
  const { user, authLoading, login, register, logout, updateProfile, updateTheme } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [themeBusy, setThemeBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [regName, setRegName] = useState("");
  const [editName, setEditName] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [formErr, setFormErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const resetForms = () => {
    setFormErr(null);
    setEmail("");
    setPassword("");
    setPassword2("");
    setRegName("");
    setEditName("");
    setOldPassword("");
    setNewPassword("");
    setConfirmNewPassword("");
  };

  const resetProfileForm = () => {
    setFormErr(null);
    setEditName(user?.displayName ?? "");
    setOldPassword("");
    setNewPassword("");
    setConfirmNewPassword("");
  };

  useEffect(() => {
    if (user && editProfileOpen) setEditName(user.displayName || "");
  }, [user, editProfileOpen]);

  const submitLogin = async (e?: FormEvent) => {
    e?.preventDefault();
    setFormErr(null);
    if (!email.trim() || !password) {
      setFormErr("Enter your email and password.");
      return;
    }
    setPending(true);
    try {
      await login(email.trim(), password);
      setLoginOpen(false);
      resetForms();
    } catch (err) {
      if (err instanceof AuthError) {
        setFormErr(err.message);
      } else {
        setFormErr(err instanceof Error ? err.message : "Sign in failed.");
      }
    } finally {
      setPending(false);
    }
  };

  const submitRegister = async () => {
    setFormErr(null);
    if (password.length < 8) {
      setFormErr("Password must be at least 8 characters.");
      return;
    }
    if (password !== password2) {
      setFormErr("Passwords do not match.");
      return;
    }
    setPending(true);
    try {
      await register(email.trim(), password, regName.trim() || undefined);
      setRegisterOpen(false);
      resetForms();
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : "Registration failed.");
    } finally {
      setPending(false);
    }
  };

  const submitEditProfile = async (e?: FormEvent) => {
    e?.preventDefault();
    setFormErr(null);

    const name = editName.trim();
    if (name && !ALPHABET_NAME.test(name)) {
      setFormErr("Display name may only contain letters.");
      return;
    }

    const changingPassword =
      oldPassword.length > 0 || newPassword.length > 0 || confirmNewPassword.length > 0;

    if (changingPassword) {
      if (newPassword !== confirmNewPassword) {
        setFormErr("new passwords don't match");
        return;
      }
      if (oldPassword && newPassword && oldPassword === newPassword) {
        setFormErr("new password cannot be the same as the old one");
        return;
      }
    }

    setPending(true);
    try {
      await updateProfile({
        displayName: name,
        ...(changingPassword
          ? {
              currentPassword: oldPassword,
              newPassword,
              confirmNewPassword,
            }
          : {}),
      });
      setEditProfileOpen(false);
      setMenuOpen(false);
      resetProfileForm();
    } catch (err) {
      if (err instanceof ProfileError) {
        setFormErr(err.message);
      } else {
        setFormErr(err instanceof Error ? err.message : "Update failed.");
      }
    } finally {
      setPending(false);
    }
  };

  const submitLogout = async () => {
    setMenuOpen(false);
    setPending(true);
    try {
      await logout();
    } catch {
      /* ignore */
    } finally {
      setPending(false);
    }
  };

  const flipTheme = async () => {
    if (!user) return;
    setThemeBusy(true);
    try {
      await updateTheme(user.themePreference === "dark" ? "light" : "dark");
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Could not save theme.");
    } finally {
      setThemeBusy(false);
    }
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        type="button"
        title={user ? user.email : "Account"}
        disabled={authLoading}
        onClick={() => {
          if (!user) {
            setLoginOpen(true);
            return;
          }
          setMenuOpen((o) => !o);
        }}
        style={{
          width: 40,
          height: 40,
          borderRadius: "50%",
          border: "1px solid var(--stroke)",
          background: user ? "rgba(94,234,212,0.15)" : "rgba(255,255,255,0.06)",
          color: "var(--text)",
          fontWeight: 700,
          fontSize: 15,
          cursor: authLoading ? "wait" : "pointer",
          display: "grid",
          placeItems: "center",
        }}
      >
        {authLoading ? "…" : avatarLetter(user)}
      </button>

      {user && menuOpen && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 8px)",
            minWidth: 200,
            background: "var(--bg1)",
            border: "1px solid var(--stroke)",
            borderRadius: 12,
            boxShadow: "var(--shadow)",
            padding: 8,
            zIndex: 70,
          }}
        >
          <div style={{ padding: "4px 8px 8px" }}>
            <div className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
              {user.email}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginTop: 6,
                flexWrap: "wrap",
              }}
            >
              {user.displayName ? (
                <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 650, flex: "1 1 auto", minWidth: 0 }}>
                  {user.displayName}
                </span>
              ) : (
                <span style={{ fontSize: 12, color: "var(--muted)", flex: "1 1 auto" }}>Appearance</span>
              )}
              <button
                type="button"
                title={user.themePreference === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                disabled={pending || themeBusy}
                onClick={() => void flipTheme()}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  border: "1px solid var(--stroke)",
                  background: "var(--bg2)",
                  color: "var(--text)",
                  flexShrink: 0,
                  display: "grid",
                  placeItems: "center",
                  marginLeft: "auto",
                }}
              >
                {themeBusy ? "…" : user.themePreference === "dark" ? <IconMoon /> : <IconSun />}
              </button>
            </div>
          </div>
          <button
            type="button"
            className="btn-ghost"
            style={{ width: "100%", marginTop: 4, justifyContent: "flex-start" }}
            onClick={() => {
              setMenuOpen(false);
              setEditProfileOpen(true);
              resetProfileForm();
            }}
          >
            Edit profile
          </button>
          <button
            type="button"
            className="btn-ghost"
            style={{ width: "100%", marginTop: 4, justifyContent: "flex-start", color: "var(--danger)" }}
            onClick={() => void submitLogout()}
            disabled={pending}
          >
            Sign out
          </button>
        </div>
      )}

      {loginOpen && (
        <Modal
          title="Sign in"
          onClose={() => {
            setLoginOpen(false);
            resetForms();
          }}
        >
          {formErr && (
            <div role="alert" className="form-error" style={{ marginBottom: 10 }}>
              {formErr}
            </div>
          )}
          <form
            style={{ display: "grid", gap: 12 }}
            onSubmit={(e) => {
              void submitLogin(e);
            }}
          >
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: "var(--muted)" }}>
              Email
              <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: "var(--muted)" }}>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            <button type="submit" className="btn-primary" disabled={pending}>
              {pending ? "Signing in…" : "Sign in"}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setLoginOpen(false);
                setRegisterOpen(true);
                setFormErr(null);
              }}
            >
              Create account
            </button>
          </form>
        </Modal>
      )}

      {registerOpen && (
        <Modal
          title="Create account"
          onClose={() => {
            setRegisterOpen(false);
            resetForms();
          }}
        >
          {formErr && (
            <div style={{ color: "#fecdd3", fontSize: 13, marginBottom: 10 }}>{formErr}</div>
          )}
          <div style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: "var(--muted)" }}>
              Email
              <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: "var(--muted)" }}>
              Password (min 8 characters)
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: "var(--muted)" }}>
              Confirm password
              <input
                type="password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: "var(--muted)" }}>
              Display name (optional — you can add it after sign-up)
              <input value={regName} onChange={(e) => setRegName(e.target.value)} />
            </label>
            <button type="button" className="btn-primary" disabled={pending} onClick={() => void submitRegister()}>
              {pending ? "Creating…" : "Create account"}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setRegisterOpen(false);
                setLoginOpen(true);
                setFormErr(null);
              }}
            >
              Back to sign in
            </button>
          </div>
        </Modal>
      )}

      {editProfileOpen && user && (
        <Modal
          title="Edit profile"
          onClose={() => {
            setEditProfileOpen(false);
            resetProfileForm();
          }}
        >
          {formErr && (
            <div role="alert" className="form-error" style={{ marginBottom: 10 }}>
              {formErr}
            </div>
          )}
          <form
            style={{ display: "grid", gap: 12 }}
            onSubmit={(e) => {
              void submitEditProfile(e);
            }}
          >
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: "var(--muted)" }}>
              Display name
              <input
                value={editName}
                onChange={(e) => setEditName(filterAlphabetName(e.target.value))}
                placeholder="Letters only — leave blank to use email initial"
                autoComplete="name"
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: "var(--muted)" }}>
              Old Password
              <HoverRevealPassword
                value={oldPassword}
                onChange={setOldPassword}
                autoComplete="current-password"
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: "var(--muted)" }}>
              New Password
              <HoverRevealPassword
                value={newPassword}
                onChange={setNewPassword}
                autoComplete="new-password"
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 13, color: "var(--muted)" }}>
              Confirm New Password
              <HoverRevealPassword
                value={confirmNewPassword}
                onChange={setConfirmNewPassword}
                autoComplete="new-password"
              />
            </label>
            <button type="submit" className="btn-primary" style={{ marginTop: 2, width: "100%" }} disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

export function CompleteProfileModal() {
  const { user, updateDisplayName } = useAuth();
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!user?.needsDisplayName) return null;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const n = name.trim();
    if (!n) {
      setErr("Please enter your name.");
      return;
    }
    if (!ALPHABET_NAME.test(n)) {
      setErr("Display name may only contain letters.");
      return;
    }
    setErr(null);
    setPending(true);
    try {
      await updateDisplayName(n);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal title="Welcome — add your name" onClose={() => {}} allowBackdropClose={false}>
      <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.5, marginTop: 0 }}>
        This is shown once so we can personalize your workspace.
      </p>
      {err && (
        <div role="alert" className="form-error" style={{ marginBottom: 10 }}>
          {err}
        </div>
      )}
      <form
        onSubmit={(e) => {
          void submit(e);
        }}
      >
        <label style={{ display: "grid", gap: 6, fontSize: 13, color: "var(--muted)" }}>
          Your name
          <input
            value={name}
            onChange={(e) => setName(filterAlphabetName(e.target.value))}
            placeholder="Jane Doe"
            autoFocus
          />
        </label>
        <button
          type="submit"
          className="btn-primary"
          style={{ marginTop: 16, width: "100%" }}
          disabled={pending}
        >
          {pending ? "Saving…" : "Continue"}
        </button>
      </form>
    </Modal>
  );
}
