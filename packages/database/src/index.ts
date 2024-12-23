/**
 * @product-dev-consulting/database
 *
 * Entry point to run migrations and seeds.
 */
import { logMessage } from "@product-dev-consulting/common";
import * as knexConfig from "./knexfile";
import knex from "knex";

async function main() {
  const environment = process.env.NODE_ENV || "development";
  const config = knexConfig;

  const db = knex(config);

  try {
    logMessage("Database", "Running migrations...");
    await db.migrate.latest();
    logMessage("Database", "Migrations completed.");

    logMessage("Database", "Running seeds...");
    await db.seed.run();
    logMessage("Database", "Seeds completed.");
  } catch (error) {
    logMessage("Database", `Error: ${error}`);
    process.exit(1);
  } finally {
    await db.destroy();
    logMessage("Database", "Database setup done.");
  }
}

main();
