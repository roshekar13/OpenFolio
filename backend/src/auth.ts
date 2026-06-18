import type { Express, NextFunction, Request, Response } from "express";
import type { Db } from "mongodb";
import bcrypt from "bcrypt";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "./db.js";
import { getClearCookieOptions, getSessionCookieName } from "./httpConfig.js";
import {
  clearApiToken,
  findUserByApiToken,
  findUserByEmail,
  findUserByLegacyId,
  insertUser,
  issueApiToken,
  rowToPublic,
  updateUserProfile,
  userDocToPublicRow,
} from "./mongo/users.js";

const registerSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(128),
  displayName: z.string().max(120).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const patchProfileSchema = z
  .object({
    displayName: z.string().min(1).max(120).optional(),
    theme: z.enum(["dark", "light"]).optional(),
  })
  .refine((b) => b.displayName !== undefined || b.theme !== undefined, {
    message: "Provide displayName and/or theme.",
  });

export type PublicUser = {
  id: string;
  email: string;
  displayName: string;
  needsDisplayName: boolean;
  themePreference: "dark" | "light";
};

function readBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length).trim();
  return token || null;
}

/** Resolve signed-in user from session cookie or Bearer token (GitHub Pages + Render). */
export async function resolveLegacyUserId(req: Request, db: Db): Promise<string | null> {
  if (req.session.userId) return req.session.userId;
  const token = readBearerToken(req);
  if (!token) return null;
  const doc = await findUserByApiToken(db, token);
  return doc?.legacy_id ?? null;
}

async function attachSessionAndToken(db: Db, req: Request, legacyId: string): Promise<string> {
  const token = await issueApiToken(db, legacyId);
  req.session.userId = legacyId;
  await new Promise<void>((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
  return token;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  void (async () => {
    try {
      const db = getDb();
      const uid = await resolveLegacyUserId(req, db);
      if (!uid) {
        res.status(401).json({ error: "Sign in required." });
        return;
      }
      req.session.userId = uid;
      next();
    } catch (e) {
      next(e);
    }
  })();
}

export function registerAuthRoutes(app: Express, db: Db): void {
  app.get("/api/auth/me", async (req, res) => {
    const uid = await resolveLegacyUserId(req, db);
    if (!uid) {
      res.json({ user: null });
      return;
    }
    const doc = await findUserByLegacyId(db, uid);
    if (!doc) {
      req.session.userId = undefined;
      res.json({ user: null });
      return;
    }
    req.session.userId = uid;
    res.json({ user: rowToPublic(userDocToPublicRow(doc)) });
  });

  app.post("/api/auth/register", async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { email, password, displayName } = parsed.data;
    const taken = await findUserByEmail(db, email.trim());
    if (taken) {
      res.status(409).json({ error: "An account with this email already exists." });
      return;
    }
    const id = nanoid();
    const hash = bcrypt.hashSync(password, 10);
    const name = (displayName ?? "").trim();
    const doc = await insertUser(db, {
      legacyId: id,
      email,
      passwordHash: hash,
      displayName: name,
    });
    try {
      const token = await attachSessionAndToken(db, req, id);
      res.status(201).json({ user: rowToPublic(userDocToPublicRow(doc)), token });
    } catch {
      res.status(500).json({ error: "Could not create session." });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const email = parsed.data.email.trim().toLowerCase();
    const doc = await findUserByEmail(db, email);
    if (!doc) {
      res.status(404).json({
        code: "EMAIL_NOT_FOUND",
        error: "Email not recognized. Please register as a new user.",
      });
      return;
    }
    if (!bcrypt.compareSync(parsed.data.password, doc.password_hash)) {
      res.status(401).json({
        code: "WRONG_PASSWORD",
        error: "Incorrect password. Please try again.",
      });
      return;
    }
    try {
      const token = await attachSessionAndToken(db, req, doc.legacy_id);
      res.json({ user: rowToPublic(userDocToPublicRow(doc)), token });
    } catch {
      res.status(500).json({ error: "Could not create session." });
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    const uid = await resolveLegacyUserId(req, db);
    if (uid) await clearApiToken(db, uid);
    req.session.destroy((err) => {
      if (err) {
        res.status(500).json({ error: "Could not sign out." });
        return;
      }
      res.clearCookie(getSessionCookieName(), getClearCookieOptions());
      res.json({ ok: true });
    });
  });

  app.patch("/api/auth/me", requireAuth, async (req, res) => {
    const parsed = patchProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const uid = req.session.userId!;
    const b = parsed.data;
    const doc = await updateUserProfile(db, uid, {
      displayName: b.displayName,
      theme: b.theme,
    });
    if (!doc) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    res.json({ user: rowToPublic(userDocToPublicRow(doc)) });
  });
}
