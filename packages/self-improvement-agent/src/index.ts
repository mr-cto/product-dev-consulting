/**
 * @product-dev-consulting/self-improvement-agent
 *
 * Monitors system performance and proposes improvements by creating GitHub PRs.
 */
import { dbPool, logMessage, sendMetric, setupRabbitMQ } from "@product-dev-consulting/common";
import { Octokit } from "@octokit/rest";
import { Configuration, LogsApi } from '@datadog/datadog-api-client';
import amqp from 'amqplib';
import { v4 as uuidv4 } from 'uuid';

const {
  GITHUB_TOKEN,
  GITHUB_REPO_OWNER,
  GITHUB_REPO_NAME,
  DATADOG_API_KEY,
  DATADOG_APP_KEY
} = process.env;

// Validate environment variables
if (!GITHUB_TOKEN || !GITHUB_REPO_OWNER || !GITHUB_REPO_NAME) {
  throw new Error("Missing GitHub configuration in environment variables.");
}

if (!DATADOG_API_KEY || !DATADOG_APP_KEY) {
  throw new Error("Missing Datadog API/App keys in environment variables.");
}

// Initialize Octokit for GitHub API
const octokit = new Octokit({
  auth: GITHUB_TOKEN
});

// Initialize Datadog Logs API
const config = new Configuration({
  authMethods: {
    apiKeyAuth: { apiKey: DATADOG_API_KEY },
    appKeyAuth: { appKey: DATADOG_APP_KEY },
  },
});
const datadogLogsApi = new LogsApi(config);

// RabbitMQ setup
let channel;
setupRabbitMQ().then((ch) => {
  channel = ch;
  logMessage("SelfImprovementAgent", "Connected to RabbitMQ");
}).catch(err => {
  logMessage("SelfImprovementAgent", `Error connecting to RabbitMQ: ${err}`);
  process.exit(1);
});

// Function to handle incoming events
async function handleEvent(event: any) {
  switch(event.type) {
    case 'system_monitoring_alert':
      await handleSystemAlert(event.data);
      break;
    // Add more event types as needed
    default:
      logMessage("SelfImprovementAgent", `Unhandled event type: ${event.type}`);
  }
}

// Function to handle system alerts from Datadog
async function handleSystemAlert(data: any) {
  const { alertType, details } = data;

  logMessage("SelfImprovementAgent", `Handling system alert: ${alertType}`);

  // Propose improvement based on alert type
  if (alertType === 'high_error_rate') {
    await proposeImprovement("Optimize database queries for better performance");
  }
  // Add more conditions based on alert types
}

// Function to propose improvement by creating a GitHub Pull Request
async function proposeImprovement(description: string) {
  logMessage("SelfImprovementAgent", "Proposing improvement via GitHub Pull Request...");

  const branchName = `improvement-${uuidv4()}`;

  try {
    // Create a new branch from main
    const { data: mainBranch } = await octokit.rest.repos.getBranch({
      owner: GITHUB_REPO_OWNER!,
      repo: GITHUB_REPO_NAME!,
      branch: "main"
    });
    const latestCommitSha = mainBranch.commit.sha;

    await octokit.rest.git.createRef({
      owner: GITHUB_REPO_OWNER!,
      repo: GITHUB_REPO_NAME!,
      ref: `refs/heads/${branchName}`,
      sha: latestCommitSha
    });

    // Create or update a configuration file as an example improvement
    const filePath = "config/improvements.json";

    let fileContent = {};
    try {
      const { data: fileData } = await octokit.rest.repos.getContent({
        owner: GITHUB_REPO_OWNER!,
        repo: GITHUB_REPO_NAME!,
        path: filePath,
        ref: branchName
      });
      fileContent = JSON.parse(Buffer.from((fileData as any).content, 'base64').toString('utf-8'));
    } catch (error: any) {
      // File does not exist, create a new one
      fileContent = {};
    }

    // Add a new improvement entry
    const improvementId = `improvement-${uuidv4()}`;
    fileContent[improvementId] = {
      description: description,
      proposedBy: "SelfImprovementAgent",
      timestamp: new Date().toISOString()
    };

    const newContent = JSON.stringify(fileContent, null, 2);

    // Get the SHA of the file to update (if exists)
    let fileSha = "";
    try {
      const { data: fileData } = await octokit.rest.repos.getContent({
        owner: GITHUB_REPO_OWNER!,
        repo: GITHUB_REPO_NAME!,
        path: filePath,
        ref: branchName
      });
      fileSha = (fileData as any).sha;
    } catch (error: any) {
      // File does not exist, no SHA needed
    }

    // Update or create the file
    await octokit.rest.repos.createOrUpdateFileContents({
      owner: GITHUB_REPO_OWNER!,
      repo: GITHUB_REPO_NAME!,
      path: filePath,
      message: `Propose system improvement: ${description}`,
      content: Buffer.from(newContent).toString('base64'),
      branch: branchName,
      sha: fileSha || undefined
    });

    // Create a pull request
    await octokit.rest.pulls.create({
      owner: GITHUB_REPO_OWNER!,
      repo: GITHUB_REPO_NAME!,
      title: `Proposed Improvement: ${description}`,
      head: branchName,
      base: "main",
      body: `This PR was automatically generated by the Self-Improvement Agent to address the following improvement:\n\n${description}`
    });

    sendMetric("ai_agent.self_improvement.proposals", 1, [`agent:self-improvement`, `action:propose-improvement`]);
    logMessage("SelfImprovementAgent", "Improvement proposal created successfully.");
  } catch (error: any) {
    logMessage("SelfImprovementAgent", `Error proposing improvement: ${error.message}`);
    throw error;
  }
}

// Function to check system health by querying Datadog logs
async function checkSystemHealth(): Promise<boolean> {
  try {
    const response = await datadogLogsApi.listLogs({
      query: "status:error",
      time: {
        _from: "now-1h",
        _to: "now"
      },
      sort: "desc",
      limit: 1
    });

    return response.data.length > 0;
  } catch (error: any) {
    logMessage("SelfImprovementAgent", `Error querying Datadog: ${error.message}`);
    return false;
  }
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
    logMessage("SelfImprovementAgent", "Started consuming events from RabbitMQ");
  } catch (error) {
    logMessage("SelfImprovementAgent", `Error consuming events: ${error}`);
    process.exit(1);
  }
}

// Main function to monitor and propose improvements
async function runSelfImprovement() {
  logMessage("SelfImprovementAgent", "Monitoring system performance...");
  
  // Check system health periodically (e.g., every hour)
  import cron from 'node-cron';

  cron.schedule('0 * * * *', async () => {
    const isUnhealthy = await checkSystemHealth();

    if (isUnhealthy) {
      await proposeImprovement("Optimize database queries for better performance");
    } else {
      logMessage("SelfImprovementAgent", "System performance is healthy. No improvements needed.");
    }

    sendMetric("ai_agent.self_improvement.checks", 1, [`agent:self-improvement`, `health:${isUnhealthy ? "unhealthy" : "healthy"}`]);
  });

  await consumeEvents();
}

// Initialize
runSelfImprovement().catch((err) => {
  logMessage("SelfImprovementAgent", `Error: ${err}`);
  process.exit(1);
});
