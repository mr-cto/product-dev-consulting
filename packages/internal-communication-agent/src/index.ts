/**
 * @product-dev-consulting/internal-communication-agent
 *
 * Facilitates internal communication among employees, including messaging, announcements,
 * and collaboration using Slack.
 */
import { dbPool, logMessage, DataProduct, InternalCommunication, sendMetric, setupRabbitMQ } from "@product-dev-consulting/common";
import { WebClient } from "@slack/web-api";
import amqp from 'amqplib';
import { v4 as uuidv4 } from 'uuid';

const {
  SLACK_BOT_TOKEN,
  SLACK_CHANNEL_ID
} = process.env;

// Validate Slack environment variables
if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) {
  throw new Error("Missing Slack configuration in environment variables.");
}

// Initialize Slack WebClient
const slackClient = new WebClient(SLACK_BOT_TOKEN);

// RabbitMQ setup
let channel;
setupRabbitMQ().then((ch) => {
  channel = ch;
  logMessage("InternalCommunicationAgent", "Connected to RabbitMQ");
}).catch(err => {
  logMessage("InternalCommunicationAgent", `Error connecting to RabbitMQ: ${err}`);
  process.exit(1);
});

// Function to handle incoming events
async function handleEvent(event: any) {
  switch(event.type) {
    case 'client_email_response':
      // Potentially handle responses if needed
      break;
    case 'internal_comm_message':
      await handleInternalCommunication(event.data);
      break;
    // Add more event types as needed
    default:
      logMessage("InternalCommunicationAgent", `Unhandled event type: ${event.type}`);
  }
}

// Function to handle internal communications
async function handleInternalCommunication(data: any) {
  const { employeeId, message, timestamp } = data;

  logMessage("InternalCommunicationAgent", `Processing internal message from employee ${employeeId}: ${message}`);

  // Fetch employee details from the database
  const employeeRes = await dbPool.query(
    `SELECT name FROM employees WHERE employee_id = $1`,
    [employeeId]
  );

  if (employeeRes.rowCount === 0) {
    logMessage("InternalCommunicationAgent", `Employee ${employeeId} not found in database.`);
    return;
  }

  const employeeName = employeeRes.rows[0].name;

  // Generate a response or follow-up action based on the message
  let response = "Acknowledged.";
  if (message.toLowerCase().includes("code review")) {
    response = "Great job on the code review!";
  } else if (message.toLowerCase().includes("update the documentation")) {
    response = "Will update the documentation by EOD.";
  }

  // Send internal response via Slack
  const slackNotification = `Responded to ${employeeName}: "${response}"`;
  await sendSlackMessage(slackNotification);

  // Record the response communication
  const responseCommunication: DataProduct<InternalCommunication> = {
    name: "internal-communication",
    schemaVersion: "1.0.0",
    timestamp: Date.now(),
    payload: {
      employeeId,
      message: response,
      timestamp: Date.now()
    }
  };

  if (channel) {
    channel.sendToQueue('agent_communication', Buffer.from(JSON.stringify({
      type: 'internal_comm_response',
      data: responseCommunication
    })), { persistent: true });
    logMessage("InternalCommunicationAgent", `Published internal_comm_response event for employee ${employeeId}`);
  }

  sendMetric("ai_agent.internal_communication.messages_processed", 1, [`agent:internal-communication`, `employee:${employeeId}`]);
}

// Function to send Slack message
async function sendSlackMessage(message: string) {
  await slackClient.chat.postMessage({
    channel: SLACK_CHANNEL_ID,
    text: message,
  });
  logMessage("InternalCommunicationAgent", `Sent Slack message: ${message}`);
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
    logMessage("InternalCommunicationAgent", "Started consuming events from RabbitMQ");
  } catch (error) {
    logMessage("InternalCommunicationAgent", `Error consuming events: ${error}`);
    process.exit(1);
  }
}

// Main function to handle internal communications
async function runInternalCommunication() {
  logMessage("InternalCommunicationAgent", "Listening for internal communications...");
  await consumeEvents();
}

// Initialize
runInternalCommunication().catch((err) => {
  logMessage("InternalCommunicationAgent", `Error: ${err}`);
  process.exit(1);
});
