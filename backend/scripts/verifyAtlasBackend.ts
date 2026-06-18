import { connectDb, closeDb, getDb } from "../src/db.js";
import { loadServerEnv, resolveMongoDbName, resolvePrimaryMongoUri, redactMongoUri } from "../src/loadEnv.js";
import { listUserTransactions } from "../src/mongo/transactions.js";
import { SEED_OWNER_ID } from "../src/migrate.js";

async function main(): Promise<void> {
  loadServerEnv();
  console.log("Primary:", `${redactMongoUri(resolvePrimaryMongoUri())}/${resolveMongoDbName()}`);
  await connectDb();
  const db = getDb();
  const counts = {
    users: await db.collection("users").countDocuments(),
    transactions: await db.collection("transactions").countDocuments(),
    watchlist: await db.collection("watchlist").countDocuments(),
    analytics_reports: await db.collection("analytics_reports").countDocuments(),
  };
  console.log("Collection counts:", counts);
  const rows = await listUserTransactions(db, SEED_OWNER_ID);
  const sample = rows[0];
  if (sample) {
    console.log("Sample transaction id:", sample.id, "ticker:", sample.ticker);
  }
  await closeDb();
  console.log("Atlas primary validation: OK");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
