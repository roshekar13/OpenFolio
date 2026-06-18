/**
 * Phase 3: One-time SQLite → MongoDB migration.
 * Reads source DB read-only; upserts into MongoDB (idempotent).
 *
 * Usage:
 *   npx tsx migration_backups/migrate.ts
 *   npx tsx migration_backups/migrate.ts --drop   # drop 4 collections first
 *   OPENFOLIO_DB=path/to.sqlite npx tsx migration_backups/migrate.ts
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { loadServerEnv, redactMongoUri, resolveMongoDbName, resolvePrimaryMongoUri } from "../src/loadEnv.js";
import { toDate, toDecimal128 } from "../src/mongo/converters.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "..");

const SOURCE =
  process.env.OPENFOLIO_DB ?? path.join(backendRoot, "data", "openfolio.sqlite");

function resolveTargetMongoUri(): string {
  if (process.argv.includes("--target") && process.argv.includes("atlas")) {
    loadServerEnv();
    return resolvePrimaryMongoUri();
  }
  loadServerEnv();
  return process.env.OPENFOLIO_LOCAL_MONGO_URI ?? "mongodb://localhost:27017";
}

const MONGO_DB = process.env.OPENFOLIO_MONGO_DB ?? "openfolio";

const COLLECTIONS = ["users", "transactions", "watchlist", "analytics_reports"] as const;
const SQLITE_TABLES = [...COLLECTIONS] as const;

type SqlUser = {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  theme: string;
  created_at: string;
};

type SqlTx = {
  id: string;
  user_id: string;
  occurred_at: string;
  side: string;
  ticker: string;
  name: string | null;
  quantity: number;
  price_usd: number;
  fx_sgd_per_usd: number;
  funding_source: string;
  fees_usd: number;
  notes: string | null;
};

type SqlWatch = { user_id: string; ticker: string; sort_order: number };
type SqlReport = {
  id: string;
  user_id: string;
  kind: string;
  body: string;
  created_at: string;
};

function sqliteQuery<T>(sql: string): T[] {
  const r = spawnSync("sqlite3", ["-readonly", SOURCE, "-json", sql], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || `sqlite3 failed: ${sql}`);
  const out = (r.stdout ?? "").trim();
  if (!out) return [];
  return JSON.parse(out) as T[];
}

function sqliteCount(table: string): number {
  const r = spawnSync("sqlite3", ["-readonly", SOURCE, `SELECT COUNT(*) FROM ${table};`], {
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(r.stderr || `count failed: ${table}`);
  return Number((r.stdout ?? "").trim());
}

async function ensureMongoIndexes(db: Db): Promise<void> {
  await db.collection("users").createIndexes([
    { key: { legacy_id: 1 }, unique: true },
    { key: { email: 1 }, unique: true },
  ]);
  await db.collection("transactions").createIndexes([
    { key: { legacy_id: 1 }, unique: true },
    { key: { user_id: 1 } },
    { key: { user_id: 1, occurred_at: 1, legacy_id: 1 } },
    { key: { ticker: 1 } },
  ]);
  await db.collection("watchlist").createIndexes([
    { key: { user_id: 1, ticker: 1 }, unique: true },
    { key: { user_id: 1, sort_order: 1 } },
  ]);
  await db.collection("analytics_reports").createIndexes([
    { key: { legacy_id: 1 }, unique: true },
    { key: { user_id: 1, kind: 1, created_at: -1 } },
  ]);
}

async function main(): Promise<void> {
  const drop = process.argv.includes("--drop");

  if (!fs.existsSync(SOURCE)) {
    console.error(`HALT: SQLite source not found: ${SOURCE}`);
    process.exit(1);
  }

  console.log("SQLite source:", SOURCE);
  const mongoUri = resolveTargetMongoUri();
  console.log("MongoDB:", `${redactMongoUri(mongoUri)}/${MONGO_DB}`);
  console.log("Mode:", drop ? "drop collections then upsert" : "upsert on legacy_id");

  const sourceCounts = Object.fromEntries(
    SQLITE_TABLES.map((t) => [t, sqliteCount(t)])
  ) as Record<(typeof SQLITE_TABLES)[number], number>;
  console.log("\nSource row counts:", sourceCounts);

  const client = new MongoClient(mongoUri, {
    serverSelectionTimeoutMS: mongoUri.includes("mongodb.net") ? 15000 : 5000,
  });
  await client.connect();
  const db = client.db(MONGO_DB);

  if (drop) {
    for (const c of COLLECTIONS) await db.collection(c).drop().catch(() => undefined);
    console.log("\nDropped target collections.");
  }

  await ensureMongoIndexes(db);

  const userMap = new Map<string, ObjectId>();

  // 1. users
  const users = sqliteQuery<SqlUser>(
    `SELECT id, email, password_hash, display_name, theme, created_at FROM users ORDER BY id;`
  );
  for (const u of users) {
    const existing = await db.collection("users").findOne({ legacy_id: u.id });
    const _id = existing?._id ?? new ObjectId();
    await db.collection("users").replaceOne(
      { legacy_id: u.id },
      {
        _id,
        legacy_id: u.id,
        email: u.email.trim().toLowerCase(),
        password_hash: u.password_hash,
        display_name: u.display_name ?? "",
        theme: u.theme === "light" ? "light" : "dark",
        created_at: toDate(u.created_at),
      },
      { upsert: true }
    );
    userMap.set(u.id, _id);
  }
  console.log(`\nMigrated users: ${users.length}`);

  // 2. transactions
  const txs = sqliteQuery<SqlTx>(
    `SELECT id, user_id, occurred_at, side, ticker, name, quantity, price_usd, fx_sgd_per_usd,
            funding_source, fees_usd, notes FROM transactions ORDER BY occurred_at, id;`
  );
  for (const t of txs) {
    if (!t.user_id) {
      throw new Error(`Orphan transaction ${t.id}: missing user_id`);
    }
    const userOid = userMap.get(t.user_id);
    if (!userOid) {
      throw new Error(`Orphan transaction ${t.id}: unresolved user_id ${t.user_id}`);
    }
    await db.collection("transactions").replaceOne(
      { legacy_id: t.id },
      {
        legacy_id: t.id,
        user_id: userOid,
        occurred_at: toDate(t.occurred_at),
        side: t.side,
        ticker: t.ticker.trim().toUpperCase(),
        name: t.name,
        quantity: toDecimal128(t.quantity),
        price_usd: toDecimal128(t.price_usd),
        fx_sgd_per_usd: toDecimal128(t.fx_sgd_per_usd),
        funding_source: t.funding_source,
        fees_usd: toDecimal128(t.fees_usd),
        notes: t.notes,
      },
      { upsert: true }
    );
  }
  console.log(`Migrated transactions: ${txs.length}`);

  // 3. watchlist
  const wl = sqliteQuery<SqlWatch>(
    `SELECT user_id, ticker, sort_order FROM watchlist ORDER BY user_id, sort_order;`
  );
  for (const w of wl) {
    const userOid = userMap.get(w.user_id);
    if (!userOid) {
      throw new Error(`Orphan watchlist row: unresolved user_id ${w.user_id}`);
    }
    const ticker = w.ticker.trim().toUpperCase();
    await db.collection("watchlist").replaceOne(
      { user_id: userOid, ticker },
      {
        user_id: userOid,
        ticker,
        sort_order: w.sort_order,
      },
      { upsert: true }
    );
  }
  console.log(`Migrated watchlist: ${wl.length}`);

  // 4. analytics_reports
  const reports = sqliteQuery<SqlReport>(
    `SELECT id, user_id, kind, body, created_at FROM analytics_reports ORDER BY created_at;`
  );
  for (const r of reports) {
    const userOid = userMap.get(r.user_id);
    if (!userOid) {
      throw new Error(`Orphan report ${r.id}: unresolved user_id ${r.user_id}`);
    }
    await db.collection("analytics_reports").replaceOne(
      { legacy_id: r.id },
      {
        legacy_id: r.id,
        user_id: userOid,
        kind: r.kind,
        body: r.body,
        created_at: toDate(r.created_at),
      },
      { upsert: true }
    );
  }
  console.log(`Migrated analytics_reports: ${reports.length}`);

  // Reconciliation
  const mongoCounts = Object.fromEntries(
    await Promise.all(
      COLLECTIONS.map(async (c) => [c, await db.collection(c).countDocuments()] as const)
    )
  ) as Record<(typeof COLLECTIONS)[number], number>;

  console.log("\n=== Reconciliation ===");
  console.log("| Collection | SQLite | MongoDB | Match |");
  let countOk = true;
  for (const c of COLLECTIONS) {
    const ok = sourceCounts[c] === mongoCounts[c];
    if (!ok) countOk = false;
    console.log(`| ${c} | ${sourceCounts[c]} | ${mongoCounts[c]} | ${ok ? "YES" : "NO"} |`);
  }

  // Referential spot-check
  const orphanTx = await db.collection("transactions").countDocuments({
    user_id: { $nin: [...userMap.values()] },
  });
  const orphanWl = await db.collection("watchlist").countDocuments({
    user_id: { $nin: [...userMap.values()] },
  });
  const orphanRep = await db.collection("analytics_reports").countDocuments({
    user_id: { $nin: [...userMap.values()] },
  });
  const allUserIds = [...userMap.values()];
  const sampleTx = await db.collection("transactions").findOne({});
  let sampleOk = true;
  if (sampleTx) {
    sampleOk = allUserIds.some((id) => id.equals(sampleTx.user_id));
  }

  console.log("\nReferential checks:");
  console.log(`  orphan transactions: ${orphanTx}`);
  console.log(`  orphan watchlist: ${orphanWl}`);
  console.log(`  orphan analytics_reports: ${orphanRep}`);
  console.log(`  sample transaction user_id resolves: ${sampleTx ? (sampleOk ? "YES" : "NO") : "n/a (empty)"}`);

  await client.close();

  if (!countOk || orphanTx > 0 || orphanWl > 0 || orphanRep > 0) {
    console.error("\nHALT: reconciliation failed.");
    process.exit(1);
  }

  console.log("\nPhase 3 migration: VERIFIED OK");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
