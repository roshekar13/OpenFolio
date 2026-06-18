import fs from "node:fs";
import path from "node:path";
import { MongoClient, type Db, type MongoClientOptions } from "mongodb";
import { redactMongoUri, resolveMongoDbName } from "./loadEnv.js";

export const SYNC_COLLECTIONS = ["users", "transactions", "watchlist", "analytics_reports"] as const;
export type SyncCollection = (typeof SYNC_COLLECTIONS)[number];

export function isAtlasUri(uri: string): boolean {
  return uri.startsWith("mongodb+srv://") || uri.includes("mongodb.net");
}

export function mongoClientOptions(uri: string): MongoClientOptions {
  const isAtlas = isAtlasUri(uri);
  return {
    maxPoolSize: isAtlas ? 10 : 5,
    minPoolSize: isAtlas ? 1 : 0,
    serverSelectionTimeoutMS: isAtlas ? 15000 : 5000,
    connectTimeoutMS: 15000,
  };
}

export async function ensureSyncIndexes(db: Db): Promise<void> {
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

export type CollectionSyncRow = {
  name: SyncCollection;
  sourceCount: number;
  destBefore: number;
  destAfter: number;
  match: boolean;
};

export async function replaceCollection(
  sourceDb: Db,
  destDb: Db,
  name: SyncCollection
): Promise<CollectionSyncRow> {
  const sourceCount = await sourceDb.collection(name).countDocuments();
  const destBefore = await destDb.collection(name).countDocuments();
  await destDb.collection(name).deleteMany({});
  const docs = await sourceDb.collection(name).find().toArray();
  if (docs.length > 0) {
    await destDb.collection(name).insertMany(docs, { ordered: true });
  }
  const destAfter = await destDb.collection(name).countDocuments();
  return {
    name,
    sourceCount,
    destBefore,
    destAfter,
    match: sourceCount === destAfter,
  };
}

export async function assertNoOrphanTransactions(db: Db): Promise<void> {
  const userIds = (
    await db.collection("users").find({}, { projection: { _id: 1 } }).toArray()
  ).map((u) => u._id);
  const orphanTx = await db.collection("transactions").countDocuments({
    user_id: { $nin: userIds },
  });
  if (orphanTx > 0) {
    throw new Error(`${orphanTx} transactions with unresolved user_id`);
  }
}

export async function syncMongoDatabases(
  sourceUri: string,
  destUri: string,
  dbName: string
): Promise<CollectionSyncRow[]> {
  const sourceClient = new MongoClient(sourceUri, mongoClientOptions(sourceUri));
  const destClient = new MongoClient(destUri, mongoClientOptions(destUri));
  await sourceClient.connect();
  await destClient.connect();

  const sourceDb = sourceClient.db(dbName);
  const destDb = destClient.db(dbName);
  const rows: CollectionSyncRow[] = [];

  try {
    for (const name of SYNC_COLLECTIONS) {
      rows.push(await replaceCollection(sourceDb, destDb, name));
    }
    await ensureSyncIndexes(destDb);
    await assertNoOrphanTransactions(destDb);
  } finally {
    await sourceClient.close();
    await destClient.close();
  }

  return rows;
}

export function printSyncTable(
  rows: CollectionSyncRow[],
  sourceLabel: string,
  destLabel: string
): void {
  console.log(`\n| Collection | ${sourceLabel} | ${destLabel} (before) | ${destLabel} (after) | Match |`);
  for (const row of rows) {
    console.log(
      `| ${row.name} | ${row.sourceCount} | ${row.destBefore} | ${row.destAfter} | ${row.match ? "YES" : "NO"} |`
    );
  }
}

export function writeSyncReconciliation(
  outPath: string,
  payload: Record<string, unknown>
): void {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
}

export function logSyncEndpoints(sourceUri: string, destUri: string, dbName: string): void {
  console.log("Source:", `${redactMongoUri(sourceUri)}/${dbName}`);
  console.log("Dest:", `${redactMongoUri(destUri)}/${dbName}`);
}
