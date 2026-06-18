/**
 * Sync OpenFolio collections between local MongoDB and Atlas.
 *
 * Initial migration (local → Atlas, primary becomes Atlas):
 *   npm run migrate:to-atlas
 *
 * Refresh local backup mirror (Atlas → local):
 *   npm run backup:mirror-local
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  logSyncEndpoints,
  printSyncTable,
  syncMongoDatabases,
  writeSyncReconciliation,
} from "../src/mongoSync.js";
import {
  loadServerEnv,
  resolveLocalBackupUri,
  resolveMongoDbName,
  resolvePrimaryMongoUri,
} from "../src/loadEnv.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseDirection(): "push" | "pull" {
  const args = process.argv.slice(2);
  if (args.includes("--pull")) return "pull";
  if (args.includes("--push")) return "push";
  return "push";
}

async function main(): Promise<void> {
  loadServerEnv();
  const direction = parseDirection();
  const dbName = resolveMongoDbName();
  const atlasUri = resolvePrimaryMongoUri();
  const localUri = resolveLocalBackupUri();

  const sourceUri = direction === "push" ? localUri : atlasUri;
  const destUri = direction === "push" ? atlasUri : localUri;
  const sourceLabel = direction === "push" ? "Local" : "Atlas";
  const destLabel = direction === "push" ? "Atlas" : "Local";

  console.log(`Mode: ${direction === "push" ? "local → Atlas (initial migration)" : "Atlas → local (backup mirror)"}`);
  logSyncEndpoints(sourceUri, destUri, dbName);

  const rows = await syncMongoDatabases(sourceUri, destUri, dbName);
  printSyncTable(rows, sourceLabel, destLabel);

  const mismatch = rows.find((r) => !r.match);
  if (mismatch) {
    console.error(`HALT: count mismatch for ${mismatch.name}`);
    process.exit(1);
  }

  const reconciliation = {
    completedAt: new Date().toISOString(),
    direction,
    dbName,
    sourceUri: sourceUri.replace(/\/\/([^:@/]+):([^@/]+)@/, "//$1:***@"),
    destUri: destUri.replace(/\/\/([^:@/]+):([^@/]+)@/, "//$1:***@"),
    collections: Object.fromEntries(
      rows.map((r) => [r.name, { source: r.sourceCount, destAfter: r.destAfter, match: r.match }])
    ),
    verified: true,
  };

  const fileName =
    direction === "push" ? "ATLAS_PUSH_RECONCILIATION.json" : "ATLAS_PULL_RECONCILIATION.json";
  const outPath = path.join(__dirname, "../migration_backups", fileName);
  writeSyncReconciliation(outPath, reconciliation);

  console.log(`\nReconciliation written: migration_backups/${fileName}`);
  console.log(direction === "push" ? "\nAtlas is now primary. Run npm run verify:atlas." : "\nLocal mirror updated from Atlas.");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
