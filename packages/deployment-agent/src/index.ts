/**
 * @product-dev-consulting/deployment-agent
 *
 * Handles deployment of products to production environments using GitHub Actions.
 */
import { dbPool, logMessage, DataProduct, DeploymentInfo, sendMetric, setupRabbitMQ } from "@product-dev-consulting/common";
import axios from "axios";
import amqp from 'amqplib';
import { Octokit } from "@octokit/rest";

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
  logMessage("DeploymentAgent", "Connected to RabbitMQ");
}).catch(err => {
  logMessage("DeploymentAgent", `Error connecting to RabbitMQ: ${err}`);
  process.exit(1);
});

// Function to handle incoming events
async function handleEvent(event: any) {
  switch(event.type) {
    case 'testing_result_passed':
      await handleTestPassed(event.data);
      break;
    case 'testing_result_failed':
      await handleTestFailed(event.data);
      break;
    // Add more event types as needed
    default:
      logMessage("DeploymentAgent", `Unhandled event type: ${event.type}`);
  }
}

// Function to handle passed tests
async function handleTestPassed(data: any) {
  const { taskId } = data;

  logMessage("DeploymentAgent", `Handling passed tests for task ${taskId}`);

  // Trigger GitHub Actions deployment workflow
  await triggerDeploymentWorkflow(taskId);

  // Update deployment status in the database
  const deploymentId = `deploy-${uuidv4()}`;
  await dbPool.query(
    `INSERT INTO deployment_info (deployment_id, task_id_ref, environment, status, timestamp, created_at, updated_at)
     VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0), NOW(), NOW())`,
    [deploymentId, taskId, "production", "triggered", Date.now()]
  );

  sendMetric("ai_agent.deployment.deployments_triggered", 1, [`agent:deployment`, `task:${taskId}`]);
}

// Function to handle failed tests
async function handleTestFailed(data: any) {
  const { taskId } = data;

  logMessage("DeploymentAgent", `Handling failed tests for task ${taskId}`);

  // Notify team via Slack
  const slackMessage = `Deployment halted for task ${taskId} due to failed tests.`;
  await sendSlackMessage(slackMessage);

  // Update deployment status in the database
  const deploymentId = `deploy-${uuidv4()}`;
  await dbPool.query(
    `INSERT INTO deployment_info (deployment_id, task_id_ref, environment, status, timestamp, created_at, updated_at)
     VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0), NOW(), NOW())`,
    [deploymentId, taskId, "production", "failed", Date.now()]
  );

  sendMetric("ai_agent.deployment.deployments_failed", 1, [`agent:deployment`, `task:${taskId}`]);
}

// Function to trigger GitHub Actions deployment workflow
async function triggerDeploymentWorkflow(taskId: string) {
  try {
    await octokit.rest.actions.createWorkflowDispatch({
      owner: GITHUB_REPO_OWNER!,
      repo: GITHUB_REPO_NAME!,
      workflow_id: 'deploy.yml', // Ensure this workflow exists in your repo
      ref: 'main',
      inputs: {
        task_id: taskId
      }
    });
    logMessage("DeploymentAgent", `Triggered deployment workflow for task ${taskId}`);
  } catch (error: any) {
    logMessage("DeploymentAgent", `Error triggering deployment workflow: ${error.message}`);
  }
}

// Function to send Slack message
async function sendSlackMessage(message: string) {
  // Initialize Slack WebClient
  const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
  const channelId = process.env.SLACK_CHANNEL_ID;

  if (!channelId) {
    logMessage("DeploymentAgent", "Missing SLACK_CHANNEL_ID in environment variables.");
    return;
  }

  await slackClient.chat.postMessage({
    channel: channelId,
    text: message,
  });
  logMessage("DeploymentAgent", `Sent Slack message: ${message}`);
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
    logMessage("DeploymentAgent", "Started consuming events from RabbitMQ");
  } catch (error) {
    logMessage("DeploymentAgent", `Error consuming events: ${error}`);
    process.exit(1);
  }
}

// Main function to handle deployment tasks
async function runDeployment() {
  logMessage("DeploymentAgent", "Listening for testing results...");
  await consumeEvents();
}

// Initialize
runDeployment().catch((err) => {
  logMessage("DeploymentAgent", `Error: ${err}`);
  process.exit(1);
});
