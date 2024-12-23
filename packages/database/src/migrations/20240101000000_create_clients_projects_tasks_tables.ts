import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Clients Table
  await knex.schema.createTable("clients", (table) => {
    table.increments("id").primary();
    table.string("client_id").notNullable().unique();
    table.string("name").notNullable();
    table.string("email").notNullable();
    table.string("phone").nullable();
    table.timestamps(true, true);
  });

  // Projects Table
  await knex.schema.createTable("projects", (table) => {
    table.increments("id").primary();
    table.string("project_id").notNullable().unique();
    table.integer("client_id_ref").notNullable();
    table.string("name").notNullable();
    table.text("description").nullable();
    table.string("status").notNullable().defaultTo("active");
    table.timestamps(true, true);

    table.foreign("client_id_ref").references("id").inTable("clients").onDelete("CASCADE");
  });

  // Tasks Table
  await knex.schema.createTable("tasks", (table) => {
    table.increments("id").primary();
    table.string("task_id").notNullable().unique();
    table.integer("project_id_ref").notNullable();
    table.string("description").notNullable();
    table.string("assigned_to").notNullable();
    table.string("status").notNullable().defaultTo("pending");
    table.date("deadline").nullable();
    table.string("repository_url").nullable();
    table.timestamps(true, true);

    table.foreign("project_id_ref").references("id").inTable("projects").onDelete("CASCADE");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("tasks");
  await knex.schema.dropTableIfExists("projects");
  await knex.schema.dropTableIfExists("clients");
}
