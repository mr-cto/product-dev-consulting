/**
 * @product-dev-consulting/testing-agent
 *
 * Manages quality assurance and testing processes for development tasks using Jest.
 */
import { dbPool, logMessage, DataProduct, TestingResult, sendMetric, setupRabbitMQ } from "@product-dev-consulting/common";
import { exec } from "child_process";
import util from "util";
import amqp from 'amqplib';

const execAsync = util.promisify(exec);

const {
  PORT
} = process.env;

// RabbitMQ setup
let channel;
setupRabbitMQ().then((ch) => {
  channel = ch;
  logMessage("TestingAgent", "Connected to RabbitMQ");
}).catch(err => {
  logMessage("TestingAgent", `Error connecting to RabbitMQ: ${err}`);
  process.exit(1);
});

// Function to handle incoming events
async function handleEvent(event: any) {
  switch(event.type) {
    case 'development_issue_created':
      await handleNewDevelopmentIssue(event.data);
      break;
    // Add more event types as needed
    default:
      logMessage("TestingAgent", `Unhandled event type: ${event.type}`);
  }
}

// Function to handle new development issues (e.g., GitHub issues)
async function handleNewDevelopmentIssue(data: any) {
  const { taskId, repositoryUrl } = data;

  logMessage("TestingAgent", `Handling new development issue for task ${taskId}`);

  // Run Jest tests related to the task
  const testResult = await runTests(taskId);

  // Update task status based on test results
  await updateTaskStatus(taskId, testResult.passed ? "completed" : "failed");

  // Record the testing result
  const dp: DataProduct<TestingResult> = {
    name: "testing-result",
    schemaVersion: "1.0.0",
    timestamp: Date.now(),
    payload: testResult
  };
  await dbPool.query(
    `INSERT INTO testing_results (test_id, task_id, passed, timestamp, created_at, updated_at)
     VALUES ($1, $2, $3, to_timestamp($4 / 1000.0), NOW(), NOW())`,
    [dp.payload.testId, taskId, dp.payload.passed, dp.timestamp]
  );

  sendMetric("ai_agent.testing.tests_run", 1, [`agent:testing`, `task:${taskId}`, `result:${testResult.passed ? "passed" : "failed"}`]);
}

// Function to run Jest tests
async function runTests(taskId: string): Promise<TestingResult> {
  try {
    // Replace with actual test command, possibly targeting specific test files
    const { stdout, stderr } = await execAsync(`yarn jest --testPathPattern=${taskId}`);
    logMessage("TestingAgent", `Tests for task ${taskId} passed.`);
    return {
      testId: `test-${uuidv4()}`,
      taskId: taskId,
      passed: true,
      timestamp: Date.now()
    };
  } catch (error) {
    logMessage("TestingAgent", `Tests for task ${taskId} failed.`);
    return {
      testId: `test-${uuidv4()}`,
      taskId: taskId,
      passed: false,
      timestamp: Date.now()
    };
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

  sendMetric("ai_agent.testing.tasks_updated", 1, [`agent:testing`, `task:${taskId}`, `status:${status}`]);
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
    logMessage("TestingAgent", "Started consuming events from RabbitMQ");
  } catch (error) {
    logMessage("TestingAgent", `Error consuming events: ${error}`);
    process.exit(1);
  }
}

// Main function to handle testing tasks
async function runTesting() {
  logMessage("TestingAgent", "Listening for development issues...");
  await consumeEvents();
}

// Initialize
runTesting().catch((err) => {
  logMessage("TestingAgent", `Error: ${err}`);
  process.exit(1);
});
