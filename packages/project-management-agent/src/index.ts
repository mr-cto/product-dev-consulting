/**
 * @product-dev-consulting/project-management-agent
 *
 * Manages project timelines, task assignments, progress tracking, and reporting using Jira.
 */
import { dbPool, logMessage, DataProduct, ProjectManagement, sendMetric, setupRabbitMQ } from "@product-dev-consulting/common";
import axios from "axios";
import amqp from 'amqplib';

const {
  JIRA_BASE_URL,
  JIRA_API_TOKEN,
  JIRA_EMAIL,
  JIRA_PROJECT_KEY
} = process.env;

// Validate Jira environment variables
if (!JIRA_BASE_URL || !JIRA_API_TOKEN || !JIRA_EMAIL || !JIRA_PROJECT_KEY) {
  throw new Error("Missing Jira configuration in environment variables.");
}

// Initialize Axios for Jira API
const jiraClient = axios.create({
  baseURL: JIRA_BASE_URL,
  headers: {
    'Authorization': `Basic ${Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64')}`,
    'Content-Type': 'application/json'
  }
});

// RabbitMQ setup
let channel;
setupRabbitMQ().then((ch) => {
  channel = ch;
  logMessage("ProjectManagementAgent", "Connected to RabbitMQ");
}).catch(err => {
  logMessage("ProjectManagementAgent", `Error connecting to RabbitMQ: ${err}`);
  process.exit(1);
});

// Function to handle incoming events
async function handleEvent(event: any) {
  switch(event.type) {
    case 'client_email_received':
      await processClientEmail(event.data);
      break;
    case 'client_email_response':
      // Handle any responses if needed
      break;
    // Add more event types as needed
    default:
      logMessage("ProjectManagementAgent", `Unhandled event type: ${event.type}`);
  }
}

// Function to process client email for project management (e.g., schedule meeting)
async function processClientEmail(data: any) {
  const { clientId, message, timestamp } = data;

  logMessage("ProjectManagementAgent", `Processing client email from ${clientId}: ${message}`);

  // Example: If a meeting was scheduled, create a corresponding Jira task
  if (message.toLowerCase().includes('meeting scheduled')) {
    await createJiraTask(clientId, message);
  }
}

// Function to create a Jira task
async function createJiraTask(clientId: string, message: string) {
  const taskSummary = `Follow-up Meeting with Client ${clientId}`;
  const taskDescription = `A meeting has been scheduled with client ${clientId}. Details: ${message}`;
  
  try {
    const response = await jiraClient.post('/rest/api/3/issue', {
      fields: {
        project: {
          key: JIRA_PROJECT_KEY
        },
        summary: taskSummary,
        description: taskDescription,
        issuetype: {
          name: "Task"
        }
      }
    });

    const issueKey = response.data.key;
    logMessage("ProjectManagementAgent", `Created Jira task ${issueKey} for client ${clientId}`);

    // Update the task in the database
    const dp: DataProduct<ProjectManagement> = {
      name: "project-management",
      schemaVersion: "1.0.0",
      timestamp: Date.now(),
      payload: {
        projectId: JIRA_PROJECT_KEY,
        task: taskSummary,
        assignedTo: "employee-004", // Assign to Project Manager
        status: "To Do",
        deadline: Date.now() + 86400000 * 14 // Two weeks from now
      }
    };

    await dbPool.query(
      `INSERT INTO project_management (project_id, task, assigned_to, status, deadline, timestamp, created_at, updated_at)
       VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0), $6, NOW(), NOW())`,
      [JIRA_PROJECT_KEY, dp.payload.task, dp.payload.assignedTo, dp.payload.status, dp.payload.deadline, dp.timestamp]
    );

    sendMetric("ai_agent.project_management.tasks_created", 1, [`agent:project-management`, `project:${JIRA_PROJECT_KEY}`]);

  } catch (error: any) {
    logMessage("ProjectManagementAgent", `Error creating Jira task: ${error.message}`);
  }
}

// Function to fetch project updates from Jira
async function fetchProjectUpdates(): Promise<ProjectManagement[]> {
  try {
    const response = await jiraClient.get(`/rest/api/3/search`, {
      params: {
        jql: `project = ${JIRA_PROJECT_KEY} AND status changed`,
        fields: ['summary', 'assignee', 'status', 'duedate']
      }
    });

    const issues = response.data.issues;
    return issues.map((issue: any) => ({
      projectId: issue.fields.project.key,
      task: issue.fields.summary,
      assignedTo: issue.fields.assignee ? issue.fields.assignee.displayName : "Unassigned",
      status: issue.fields.status.name,
      deadline: issue.fields.duedate ? new Date(issue.fields.duedate).getTime() : Date.now() + 86400000 * 7
    }));
  } catch (error) {
    logMessage("ProjectManagementAgent", `Error fetching Jira data: ${error}`);
    return [];
  }
}

// Function to update project tasks in the database
async function updateProjectTasks(updates: ProjectManagement[]) {
  for (const update of updates) {
    logMessage("ProjectManagementAgent", `Updating task for project ${update.projectId}: ${update.task}`);

    // Insert or update task status
    await dbPool.query(
      `UPDATE tasks
       SET status = $1, assigned_to = $2, deadline = to_timestamp($3 / 1000.0), updated_at = NOW()
       WHERE task_id = $4`,
      [update.status, update.assignedTo, update.deadline, getTaskId(update.task)]
    );

    // Record the project management data product
    const dp: DataProduct<ProjectManagement> = {
      name: "project-management",
      schemaVersion: "1.0.0",
      timestamp: Date.now(),
      payload: update
    };
    await dbPool.query(
      `INSERT INTO project_management (project_id, task, assigned_to, status, deadline, timestamp, created_at, updated_at)
       VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0), $6, NOW(), NOW())`,
      [update.projectId, update.task, update.assignedTo, update.status, update.deadline, dp.timestamp]
    );

    sendMetric("ai_agent.project_management.tasks_updated", 1, [`agent:project-management`, `project:${update.projectId}`]);
  }
}

function getTaskId(taskDescription: string): string {
  // Simple function to derive task_id from task description
  return taskDescription.toLowerCase().replace(/ /g, "-");
}

// Function to consume events from RabbitMQ
async function consumeEvents() {
  try {
    const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost');
    const channel = await connection.createChannel();
    await channel.assertQueue('agent_communication', { durable: true });
    channel.consume('agent_communication', async (msg) => {
      if (msg !== null) {
        const event = JSON.parse(msg.content.toString());
        await handleEvent(event);
        channel.ack(msg);
      }
    });
    logMessage("ProjectManagementAgent", "Started consuming events from RabbitMQ");
  } catch (error) {
    logMessage("ProjectManagementAgent", `Error consuming events: ${error}`);
    process.exit(1);
  }
}

// Main function to handle project management tasks
async function runProjectManagement() {
  logMessage("ProjectManagementAgent", "Fetching project updates from Jira...");
  const updates = await fetchProjectUpdates();

  await updateProjectTasks(updates);

  logMessage("ProjectManagementAgent", "Project management tasks updated.");
  process.exit(0);
}

// Initialize event consumption
consumeEvents();

// Optionally, run periodic updates
import cron from 'node-cron';

cron.schedule('0 * * * *', () => {
  runProjectManagement().catch(err => logMessage("ProjectManagementAgent", `Error: ${err}`));
});
