/** Render API in production; empty in dev uses Vite proxy (/api). */
export const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ??
  (import.meta.env.PROD ? "https://openfolio-ehjc.onrender.com" : "");

const AUTH_TOKEN_KEY = "openfolio_auth_token";

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
    else localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    /* private browsing / blocked storage */
  }
}

function resolveUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (typeof input !== "string") return input;
  if (input.startsWith("http://") || input.startsWith("https://")) return input;
  if (!API_BASE) return input;
  return `${API_BASE}${input.startsWith("/") ? input : `/${input}`}`;
}

/** Sends session cookies and Bearer token (required for GitHub Pages → Render). */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const token = getAuthToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(resolveUrl(input), {
    credentials: "include",
    ...init,
    headers,
  });
}
