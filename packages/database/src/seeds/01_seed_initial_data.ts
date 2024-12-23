import { Knex } from "knex";

export async function seed(knex: Knex): Promise<void> {
  // Clear existing data
  await knex("support_resolutions").del();
  await knex("deployment_info").del();
  await knex("testing_results").del();
  await knex("support_tickets").del();
  await knex("documents").del();
  await knex("communications").del();
  await knex("tasks").del();
  await knex("projects").del();
  await knex("clients").del();
  await knex("employees").del();
  await knex("internal_communications").del();

  // Insert clients
  const clients = await knex("clients").insert([
    { client_id: "client-001", name: "Acme Corp", email: "contact@acmecorp.com", phone: "123-456-7890" },
    { client_id: "client-002", name: "Globex Inc", email: "info@globex.com", phone: "098-765-4321" }
  ]).returning("*");

  // Insert projects
  const projects = await knex("projects").insert([
    { project_id: "project-001", client_id_ref: clients[0].id, name: "Website Redesign", description: "Redesign the corporate website for Acme Corp." },
    { project_id: "project-002", client_id_ref: clients[1].id, name: "Mobile App Development", description: "Develop a mobile application for Globex Inc." }
  ]).returning("*");

  // Insert tasks
  await knex("tasks").insert([
    { task_id: "task-001", project_id_ref: projects[0].id, description: "Design new homepage", assigned_to: "employee-001", status: "in-progress", deadline: new Date("2024-05-01"), repository_url: "https://github.com/mrtco-ai/project-001" },
    { task_id: "task-002", project_id_ref: projects[0].id, description: "Implement responsive layout", assigned_to: "employee-002", status: "pending", deadline: new Date("2024-05-15"), repository_url: "https://github.com/mrtco-ai/project-001" },
    { task_id: "task-003", project_id_ref: projects[1].id, description: "Develop authentication module", assigned_to: "employee-003", status: "pending", deadline: new Date("2024-06-01"), repository_url: "https://github.com/mrtco-ai/project-002" }
  ]);

  // Insert communications
  await knex("communications").insert([
    { communication_id: "comm-001", client_id_ref: clients[0].id, agent: "client-communication-agent", message: "Initial project kickoff meeting scheduled.", timestamp: Date.now() },
    { communication_id: "comm-002", client_id_ref: clients[1].id, agent: "client-communication-agent", message: "Requirement gathering completed.", timestamp: Date.now() }
  ]);

  // Insert documents
  await knex("documents").insert([
    { document_id: "doc-001", project_id_ref: projects[0].id, title: "Website Redesign Requirements", content: "Detailed requirements for website redesign.", timestamp: Date.now() },
    { document_id: "doc-002", project_id_ref: projects[1].id, title: "Mobile App Specifications", content: "Specifications for Globex Inc.'s mobile application.", timestamp: Date.now() }
  ]);

  // Insert support tickets
  await knex("support_tickets").insert([
    { ticket_id: "ticket-001", client_id_ref: clients[0].id, issue: "Login page not loading.", status: "open", timestamp: Date.now() },
    { ticket_id: "ticket-002", client_id_ref: clients[1].id, issue: "App crashes on launch.", status: "open", timestamp: Date.now() }
  ]);

  // Insert employees
  const employees = await knex("employees").insert([
    { employee_id: "employee-001", name: "Alice Johnson", email: "alice@mrtco.ai", role: "Developer" },
    { employee_id: "employee-002", name: "Bob Smith", email: "bob@mrtco.ai", role: "Designer" },
    { employee_id: "employee-003", name: "Charlie Lee", email: "charlie@mrtco.ai", role: "QA Engineer" },
    { employee_id: "employee-004", name: "Diana Prince", email: "diana@mrtco.ai", role: "Project Manager" }
  ]).returning("*");

  // Insert internal communications
  await knex("internal_communications").insert([
    { communication_id: "comm-001", employee_id_ref: employees[0].id, message: "Code review for task-001 completed.", timestamp: Date.now() },
    { communication_id: "comm-002", employee_id_ref: employees[1].id, message: "Please update the documentation for project-002.", timestamp: Date.now() }
  ]);
}
