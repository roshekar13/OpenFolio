import bcrypt from "bcrypt";
import { MongoClient, MongoNetworkError, type Db, type MongoClientOptions } from "mongodb";
import {
  assertProductionMongoConfigured,
  loadServerEnv,
  redactMongoUri,
  resolveMongoDbName,
  resolveMongoUri,
  resolveMongoUriOrDefault,
} from "./loadEnv.js";
import { SEED_OWNER_EMAIL, SEED_OWNER_ID } from "./migrate.js";

const DEFAULT_WATCHLIST = ["CRWD", "MDB", "AMZN"] as const;

let client: MongoClient | null = null;
let db: Db | null = null;

function isAtlasUri(uri: string): boolean {
  return uri.startsWith("mongodb+srv://") || uri.includes("mongodb.net");
}

function clientOptions(uri: string): MongoClientOptions {
  const isAtlas = isAtlasUri(uri);
  return {
    maxPoolSize: isAtlas ? 10 : 5,
    minPoolSize: isAtlas ? 1 : 0,
    serverSelectionTimeoutMS: isAtlas ? 15000 : 5000,
    connectTimeoutMS: 15000,
  };
}

function atlasConnectionHelp(): string {
  return [
    "MongoDB Atlas connection failed (TLS/network). Check:",
    "  1. Atlas → Network Access → add 0.0.0.0/0 (allow from anywhere) for Render.",
    "  2. Render env MONGO_URI is the full mongodb+srv://... string from Atlas (no quotes).",
    "  3. Database user password matches Atlas; URL-encode special characters in the URI.",
    "  4. Cluster is running (not paused) and the hostname in the URI is correct.",
  ].join("\n");
}

export async function connectDb(): Promise<Db> {
  if (db) return db;
  loadServerEnv();
  assertProductionMongoConfigured();
  const uri = resolveMongoUriOrDefault();
  const dbName = resolveMongoDbName();
  console.log(`Connecting to MongoDB ${redactMongoUri(uri)} (db: ${dbName})`);
  client = new MongoClient(uri, clientOptions(uri));
  try {
    await client.connect();
  } catch (e) {
    if (e instanceof MongoNetworkError && isAtlasUri(uri)) {
      throw new Error(`${e.message}\n\n${atlasConnectionHelp()}`);
    }
    throw e;
  }
  db = client.db(dbName);
  await ensureIndexes(db);
  await ensureSeedOwner(db);
  await ensureSeedWatchlist(db);
  return db;
}

export function getDb(): Db {
  if (!db) throw new Error("Database not connected. Call connectDb() first.");
  return db;
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

async function ensureIndexes(database: Db): Promise<void> {
  await database.collection("users").createIndexes([
    { key: { legacy_id: 1 }, unique: true },
    { key: { email: 1 }, unique: true },
  ]);
  await database.collection("transactions").createIndexes([
    { key: { legacy_id: 1 }, unique: true },
    { key: { user_id: 1 } },
    { key: { user_id: 1, occurred_at: 1, legacy_id: 1 } },
    { key: { ticker: 1 } },
  ]);
  await database.collection("watchlist").createIndexes([
    { key: { user_id: 1, ticker: 1 }, unique: true },
    { key: { user_id: 1, sort_order: 1 } },
  ]);
  await database.collection("analytics_reports").createIndexes([
    { key: { legacy_id: 1 }, unique: true },
    { key: { user_id: 1, kind: 1, created_at: -1 } },
  ]);
}

async function ensureSeedOwner(database: Db): Promise<void> {
  const users = database.collection("users");
  const existing = await users.findOne({ email: SEED_OWNER_EMAIL.toLowerCase() });
  if (existing) return;

  const pwd = process.env.OPENFOLIO_OWNER_PASSWORD ?? "hello123";
  const hash = bcrypt.hashSync(pwd, 10);
  await users.insertOne({
    legacy_id: SEED_OWNER_ID,
    email: SEED_OWNER_EMAIL.toLowerCase(),
    password_hash: hash,
    display_name: "Rohan",
    theme: "dark",
    created_at: new Date(),
  });
}

async function ensureSeedWatchlist(database: Db): Promise<void> {
  const owner = await database.collection("users").findOne({ legacy_id: SEED_OWNER_ID });
  if (!owner) return;
  const n = await database.collection("watchlist").countDocuments({ user_id: owner._id });
  if (n > 0) return;
  await database.collection("watchlist").insertMany(
    DEFAULT_WATCHLIST.map((ticker, sort_order) => ({
      user_id: owner._id,
      ticker,
      sort_order,
    }))
  );
}
