import { POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB } from "@product-dev-consulting/common";

const config = {
  client: "pg",
  connection: {
    host: POSTGRES_HOST,
    port: Number(POSTGRES_PORT || 5432),
    user: POSTGRES_USER,
    password: POSTGRES_PASSWORD,
    database: POSTGRES_DB
  },
  migrations: {
    tableName: "knex_migrations",
    directory: "./migrations"
  },
  seeds: {
    directory: "./seeds"
  }
};

module.exports = config;
