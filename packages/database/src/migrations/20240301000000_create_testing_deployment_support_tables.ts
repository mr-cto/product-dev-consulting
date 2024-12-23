import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Testing Results Table
  await knex.schema.createTable("testing_results", (table) => {
    table.increments("id").primary();
    table.string("test_id").notNullable().unique();
    table.integer("task_id_ref").notNullable();
    table.boolean("passed").notNullable();
    table.bigInteger("timestamp").notNullable();
    table.timestamps(true, true);

    table.foreign("task_id_ref").references("id").inTable("tasks").onDelete("CASCADE");
  });

  // Deployment Info Table
  await knex.schema.createTable("deployment_info", (table) => {
    table.increments("id").primary();
    table.string("deployment_id").notNullable().unique();
    table.integer("task_id_ref").notNullable();
    table.string("environment").notNullable();
    table.string("status").notNullable();
    table.bigInteger("timestamp").notNullable();
    table.timestamps(true, true);

    table.foreign("task_id_ref").references("id").inTable("tasks").onDelete("CASCADE");
  });

  // Support Resolutions Table
  await knex.schema.createTable("support_resolutions", (table) => {
    table.increments("id").primary();
    table.string("resolution_id").notNullable().unique();
    table.string("ticket_id_ref").notNullable();
    table.text("resolution").notNullable();
    table.bigInteger("timestamp").notNullable();
    table.timestamps(true, true);

    table.foreign("ticket_id_ref").references("id").inTable("support_tickets").onDelete("CASCADE");
  });

  // Employees Table (for internal communications)
  await knex.schema.createTable("employees", (table) => {
    table.increments("id").primary();
    table.string("employee_id").notNullable().unique();
    table.string("name").notNullable();
    table.string("email").notNullable();
    table.string("role").notNullable();
    table.timestamps(true, true);
  });

  // Internal Communications Table
  await knex.schema.createTable("internal_communications", (table) => {
    table.increments("id").primary();
    table.string("communication_id").notNullable().unique();
    table.integer("employee_id_ref").notNullable();
    table.text("message").notNullable();
    table.bigInteger("timestamp").notNullable();
    table.timestamps(true, true);

    table.foreign("employee_id_ref").references("id").inTable("employees").onDelete("CASCADE");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("internal_communications");
  await knex.schema.dropTableIfExists("employees");
  await knex.schema.dropTableIfExists("support_resolutions");
  await knex.schema.dropTableIfExists("deployment_info");
  await knex.schema.dropTableIfExists("testing_results");
}
