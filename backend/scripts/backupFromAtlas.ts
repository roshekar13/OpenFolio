/**
 * Backup the Atlas primary database to local JSON files (and optional local Mongo mirror).
 *
 * Usage:
 *   npm run backup:from-atlas
 *   npm run backup:from-atlas -- --mirror-local
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import { SYNC_COLLECTIONS } from "../src/mongoSync.js";
import {
  loadServerEnv,
  redactMongoUri,
  resolveLocalBackupUri,
  resolveMongoDbName,
  resolvePrimaryMongoUri,
} from "../src/loadEnv.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function backupJson(atlasUri: string, dbName: string, outDir: string): Promise<Record<string, number>> {
  const client = new MongoClient(atlasUri);
  await client.connect();
  const db = client.db(dbName);
  fs.mkdirSync(outDir, { recursive: true });

  const counts: Record<string, number> = {};
  for (const name of SYNC_COLLECTIONS) {
    const docs = await db.collection(name).find().toArray();
    counts[name] = docs.length;
    fs.writeFileSync(path.join(outDir, `${name}.json`), `${JSON.stringify(docs, null, 2)}\n`);
  }

  fs.writeFileSync(
    path.join(outDir, "manifest.json"),
    `${JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        db: dbName,
        uri: redactMongoUri(atlasUri),
        counts,
        note: "Extended JSON backup from Atlas primary; Decimal128 stored as {$numberDecimal:...}",
      },
      null,
      2
    )}\n`
  );

  await client.close();
  return counts;
}

function backupMongodump(atlasUri: string, dbName: string, outDir: string): boolean {
  const r = spawnSync("mongodump", ["--uri", atlasUri, "--db", dbName, `--out=${outDir}`], {
    encoding: "utf8",
  });
  if (r.status !== 0) {
    console.warn("mongodump unavailable or failed:", r.stderr || r.stdout);
    return false;
  }
  console.log("mongodump backup written to:", path.join(outDir, dbName));
  return true;
}

async function main(): Promise<void> {
  loadServerEnv();
  const mirrorLocal = process.argv.includes("--mirror-local");
  const atlasUri = resolvePrimaryMongoUri();
  const dbName = resolveMongoDbName();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(__dirname, "../migration_backups", `atlas-backup-${stamp}`);

  console.log("Atlas primary:", `${redactMongoUri(atlasUri)}/${dbName}`);
  console.log("Writing JSON backup to:", outDir);

  const usedMongodump = backupMongodump(atlasUri, dbName, outDir);
  const jsonDir = path.join(outDir, "driver-json");
  const counts = await backupJson(atlasUri, dbName, jsonDir);
  console.log("Counts:", counts);

  if (!usedMongodump) {
    console.log("Tip: install MongoDB Database Tools for BSON mongodump archives.");
  }

  if (mirrorLocal) {
    console.log("\nMirroring Atlas → local MongoDB...");
    const { syncMongoDatabases, printSyncTable } = await import("../src/mongoSync.js");
    const localUri = resolveLocalBackupUri();
    const rows = await syncMongoDatabases(atlasUri, localUri, dbName);
    printSyncTable(rows, "Atlas", "Local");
  }

  console.log("\nAtlas backup: OK");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
