/**
 * @product-dev-consulting/development-agent
 *
 * Handles development tasks and feature implementation using GitHub.
 */
import { dbPool, logMessage, DataProduct, DevelopmentTask, sendMetric, setupRabbitMQ } from "@product-dev-consulting/common";
import { Octokit } from "@octokit/rest";
import amqp from 'amqplib';
import { v4 as uuidv4 } from 'uuid';

const {
  GITHUB_TOKEN,
  GITHUB_REPO_OWNER,
  GITHUB_REPO_NAME
} = process.env;

// Validate GitHub environment variables
if (!GITHUB_TOKEN || !GITHUB_REPO_OWNER || !GITHUB_REPO_NAME) {
  throw new Error("Missing GitHub configuration in environment variables.");
}

// Initialize Octokit
const octokit = new Octokit({
  auth: GITHUB_TOKEN
});

// RabbitMQ setup
let channel;
setupRabbitMQ().then((ch) => {
  channel = ch;
  logMessage("DevelopmentAgent", "Connected to RabbitMQ");
}).catch(err => {
  logMessage("DevelopmentAgent", `Error connecting to RabbitMQ: ${err}`);
  process.exit(1);
});

// Function to handle incoming events
async function handleEvent(event: any) {
  switch(event.type) {
    case 'project_management_task_created':
      await handleNewProjectTask(event.data);
      break;
    // Add more event types as needed
    default:
      logMessage("DevelopmentAgent", `Unhandled event type: ${event.type}`);
  }
}

// Function to handle new project tasks from Project Management Agent
async function handleNewProjectTask(data: any) {
  const { projectId, task, assignedTo, status, deadline } = data;

  logMessage("DevelopmentAgent", `Handling new task for project ${projectId}: ${task}`);

  // Create GitHub issue or branch as needed
  await createGitHubIssue(task, assignedTo);

  // Update task status in the database
  await updateTaskStatus(task, "in-progress");
}

// Function to create a GitHub issue
async function createGitHubIssue(taskDescription: string, assignee: string) {
  try {
    const response = await octokit.rest.issues.create({
      owner: GITHUB_REPO_OWNER!,
      repo: GITHUB_REPO_NAME!,
      title: taskDescription,
      body: `Assigned to ${assignee}`,
      assignees: [assignee],
      labels: ['development']
    });

    const issueNumber = response.data.number;
    logMessage("DevelopmentAgent", `Created GitHub issue #${issueNumber} for task: ${taskDescription}`);

    // Update the task in the database with GitHub issue URL
    await dbPool.query(
      `UPDATE development_tasks
       SET repository_url = $1, status = $2, updated_at = NOW()
       WHERE task_id = $3`,
      [`https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/issues/${issueNumber}`, "in-progress", getTaskId(taskDescription)]
    );

    sendMetric("ai_agent.development.issues_created", 1, [`agent:development`, `issue:${issueNumber}`]);

  } catch (error: any) {
    logMessage("DevelopmentAgent", `Error creating GitHub issue: ${error.message}`);
  }
}

// Function to update task status
async function updateTaskStatus(taskId: string, status: string) {
  await dbPool.query(
    `UPDATE development_tasks
     SET status = $1, updated_at = NOW()
     WHERE task_id = $2`,
    [status, taskId]
  );

  sendMetric("ai_agent.development.tasks_updated", 1, [`agent:development`, `task:${taskId}`, `status:${status}`]);
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
    logMessage("DevelopmentAgent", "Started consuming events from RabbitMQ");
  } catch (error) {
    logMessage("DevelopmentAgent", `Error consuming events: ${error}`);
    process.exit(1);
  }
}

// Main function to handle development tasks
async function runDevelopment() {
  logMessage("DevelopmentAgent", "Listening for project management tasks...");
  await consumeEvents();
}

// Initialize
runDevelopment().catch((err) => {
  logMessage("DevelopmentAgent", `Error: ${err}`);
  process.exit(1);
});
