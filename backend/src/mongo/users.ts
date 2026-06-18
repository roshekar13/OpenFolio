import type { Db } from "mongodb";
import { nanoid } from "nanoid";
import type { PublicUser } from "../auth.js";
import type { UserDoc } from "./types.js";
import { toIsoString } from "./converters.js";

type UserPublicRow = {
  id: string;
  email: string;
  display_name: string;
  theme?: string | null;
};

export function userDocToPublicRow(doc: UserDoc): UserPublicRow {
  return {
    id: doc.legacy_id,
    email: doc.email,
    display_name: doc.display_name,
    theme: doc.theme,
  };
}

export function rowToPublic(row: UserPublicRow): PublicUser {
  const displayName = (row.display_name ?? "").trim();
  const themePreference: "dark" | "light" = row.theme === "light" ? "light" : "dark";
  return {
    id: row.id,
    email: row.email,
    displayName: displayName || "",
    needsDisplayName: !displayName,
    themePreference,
  };
}

export async function findUserByLegacyId(db: Db, legacyId: string): Promise<UserDoc | null> {
  return db.collection<UserDoc>("users").findOne({ legacy_id: legacyId });
}

export async function findUserByEmail(db: Db, email: string): Promise<UserDoc | null> {
  return db.collection<UserDoc>("users").findOne({ email: email.trim().toLowerCase() });
}

export async function findUserByApiToken(db: Db, token: string): Promise<UserDoc | null> {
  const trimmed = token.trim();
  if (!trimmed) return null;
  return db.collection<UserDoc>("users").findOne({ api_token: trimmed });
}

export async function issueApiToken(db: Db, legacyId: string): Promise<string> {
  const token = nanoid(48);
  await db.collection<UserDoc>("users").updateOne({ legacy_id: legacyId }, { $set: { api_token: token } });
  return token;
}

export async function clearApiToken(db: Db, legacyId: string): Promise<void> {
  await db.collection<UserDoc>("users").updateOne({ legacy_id: legacyId }, { $unset: { api_token: "" } });
}

export async function insertUser(
  db: Db,
  input: { legacyId: string; email: string; passwordHash: string; displayName: string }
): Promise<UserDoc> {
  const doc: Omit<UserDoc, "_id"> = {
    legacy_id: input.legacyId,
    email: input.email.trim().toLowerCase(),
    password_hash: input.passwordHash,
    display_name: input.displayName,
    theme: "dark",
    created_at: new Date(),
  };
  const { insertedId } = await db.collection("users").insertOne(doc);
  return { _id: insertedId, ...doc };
}

export async function updateUserProfile(
  db: Db,
  legacyId: string,
  patch: { displayName?: string; theme?: "dark" | "light" }
): Promise<UserDoc | null> {
  const $set: Partial<UserDoc> = {};
  if (patch.displayName !== undefined) $set.display_name = patch.displayName.trim();
  if (patch.theme !== undefined) $set.theme = patch.theme;
  if (Object.keys($set).length === 0) return findUserByLegacyId(db, legacyId);
  const result = await db.collection<UserDoc>("users").findOneAndUpdate(
    { legacy_id: legacyId },
    { $set },
    { returnDocument: "after" }
  );
  return result;
}

export function userCreatedAtIso(doc: UserDoc): string {
  return toIsoString(doc.created_at);
}
