import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Communications Table
  await knex.schema.createTable("communications", (table) => {
    table.increments("id").primary();
    table.string("communication_id").notNullable().unique();
    table.integer("client_id_ref").notNullable();
    table.string("agent").notNullable();
    table.text("message").notNullable();
    table.bigInteger("timestamp").notNullable();
    table.timestamps(true, true);

    table.foreign("client_id_ref").references("id").inTable("clients").onDelete("CASCADE");
  });

  // Documents Table
  await knex.schema.createTable("documents", (table) => {
    table.increments("id").primary();
    table.string("document_id").notNullable().unique();
    table.integer("project_id_ref").notNullable();
    table.string("title").notNullable();
    table.text("content").notNullable();
    table.bigInteger("timestamp").notNullable();
    table.boolean("processed").notNullable().defaultTo(false);
    table.timestamps(true, true);

    table.foreign("project_id_ref").references("id").inTable("projects").onDelete("CASCADE");
  });

  // Support Tickets Table
  await knex.schema.createTable("support_tickets", (table) => {
    table.increments("id").primary();
    table.string("ticket_id").notNullable().unique();
    table.integer("client_id_ref").notNullable();
    table.text("issue").notNullable();
    table.string("status").notNullable().defaultTo("open");
    table.bigInteger("timestamp").notNullable();
    table.timestamps(true, true);

    table.foreign("client_id_ref").references("id").inTable("clients").onDelete("CASCADE");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("support_tickets");
  await knex.schema.dropTableIfExists("documents");
  await knex.schema.dropTableIfExists("communications");
}
