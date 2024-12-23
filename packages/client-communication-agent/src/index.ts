/**
 * @product-dev-consulting/client-communication-agent
 *
 * Handles external communication with clients, including sending emails and Slack messages.
 * Processes inbound client requests using Google Workspace (Gmail).
 */
import { dbPool, logMessage, DataProduct, ClientCommunication, sendMetric, setupRabbitMQ, sendEmail, createCalendarEvent } from "@product-dev-consulting/common";
import { WebClient } from "@slack/web-api";
import { gmail, oAuth2Client, transporter } from "@product-dev-consulting/common";
import express from 'express';
import bodyParser from 'body-parser';
import { v4 as uuidv4 } from 'uuid';

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const {
  SLACK_BOT_TOKEN,
  SLACK_CHANNEL_ID,
  DOMAIN_NAME
} = process.env;

// Initialize Slack WebClient
if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) {
  throw new Error("Missing Slack configuration in environment variables.");
}
const slackClient = new WebClient(SLACK_BOT_TOKEN);

// RabbitMQ setup
let channel;
setupRabbitMQ().then((ch) => {
  channel = ch;
  logMessage("ClientCommunicationAgent", "Connected to RabbitMQ");
}).catch(err => {
  logMessage("ClientCommunicationAgent", `Error connecting to RabbitMQ: ${err}`);
  process.exit(1);
});

// Endpoint to handle SendGrid Inbound Parse Webhook equivalent using Gmail API
app.post('/gmail/inbound', async (req, res) => {
  const { from, subject, body } = req.body; // Adjust according to Gmail webhook payload

  logMessage("ClientCommunicationAgent", `Received email from ${from}: ${subject}`);

  // Extract client ID from email (assuming email is unique per client)
  const clientId = await getClientIdByEmail(from);

  if (!clientId) {
    logMessage("ClientCommunicationAgent", `Client with email ${from} not found.`);
    res.status(400).send('Client not found');
    return;
  }

  // Categorize the message
  const category = categorizeMessage(body);

  // Create communication record
  const communication: DataProduct<ClientCommunication> = {
    name: "client-communication",
    schemaVersion: "1.0.0",
    timestamp: Date.now(),
    payload: {
      clientId,
      message: body,
      timestamp: Date.now()
    }
  };

  // Publish event to RabbitMQ
  if (channel) {
    channel.sendToQueue('agent_communication', Buffer.from(JSON.stringify({
      type: 'client_email_received',
      data: communication
    })), { persistent: true });
    logMessage("ClientCommunicationAgent", `Published client_email_received event for client ${clientId}`);
  }

  res.status(200).send('Email received and processed');
});

// Function to get client ID by email
async function getClientIdByEmail(email: string): Promise<string | null> {
  const res = await dbPool.query(
    `SELECT client_id FROM clients WHERE email = $1`,
    [email]
  );
  if (res.rowCount > 0) {
    return res.rows[0].client_id;
  }
  return null;
}

// Function to categorize message
function categorizeMessage(message: string): string {
  const lowerMessage = message.toLowerCase();
  if (lowerMessage.includes('schedule a meeting') || lowerMessage.includes('call')) {
    return 'meeting_request';
  }
  return 'general_inquiry';
}

// Function to handle incoming events
async function handleEvent(event: any) {
  switch(event.type) {
    case 'client_email_received':
      await processClientEmail(event.data.payload);
      break;
    // Add more event types as needed
    default:
      logMessage("ClientCommunicationAgent", `Unhandled event type: ${event.type}`);
  }
}

// Function to process client email
async function processClientEmail(communication: ClientCommunication) {
  const { clientId, message, timestamp } = communication;

  logMessage("ClientCommunicationAgent", `Processing communication from client ${clientId}: ${message}`);

  // Handle based on category
  const category = categorizeMessage(message);
  if (category === 'meeting_request') {
    // Schedule a meeting
    await scheduleMeeting(clientId, message);
  } else {
    // Handle general inquiry
    await handleGeneralInquiry(clientId, message);
  }
}

// Function to handle general inquiry
async function handleGeneralInquiry(clientId: string, message: string) {
  // Generate a standard response
  const subject = "Re: Your Inquiry";
  const response = "Thank you for reaching out. We have received your message and will get back to you shortly.";

  // Fetch client email
  const clientRes = await dbPool.query(
    `SELECT email FROM clients WHERE client_id = $1`,
    [clientId]
  );

  if (clientRes.rowCount === 0) {
    logMessage("ClientCommunicationAgent", `Client ${clientId} not found in database.`);
    return;
  }

  const clientEmail = clientRes.rows[0].email;

  // Send email response
  await sendEmail(clientEmail, subject, response);

  // Send Slack notification to the team
  const slackNotification = `Responded to ${clientId}: "${subject}"`;
  await sendSlackMessage(slackNotification);

  // Record the response communication
  const responseCommunication: DataProduct<ClientCommunication> = {
    name: "client-communication",
    schemaVersion: "1.0.0",
    timestamp: Date.now(),
    payload: {
      clientId,
      message: response,
      timestamp: Date.now()
    }
  };

  if (channel) {
    channel.sendToQueue('agent_communication', Buffer.from(JSON.stringify({
      type: 'client_email_response',
      data: responseCommunication
    })), { persistent: true });
    logMessage("ClientCommunicationAgent", `Published client_email_response event for client ${clientId}`);
  }

  sendMetric("ai_agent.client_communication.messages_processed", 1, [`agent:client-communication`, `client:${clientId}`]);
}

// Function to send Slack message
async function sendSlackMessage(message: string) {
  await slackClient.chat.postMessage({
    channel: SLACK_CHANNEL_ID,
    text: message,
  });
  logMessage("ClientCommunicationAgent", `Sent Slack message: ${message}`);
}

// Function to schedule meeting
async function scheduleMeeting(clientId: string, message: string) {
  // Define meeting details (this can be enhanced to extract from message)
  const meetingDetails = {
    summary: "Project Kickoff Meeting",
    location: "Google Meet",
    description: "Initial meeting to discuss project requirements and timelines.",
    startTime: new Date(Date.now() + 86400000).toISOString(), // Tomorrow
    endTime: new Date(Date.now() + 86400000 + 3600000).toISOString(), // Tomorrow + 1 hour
    attendees: []
  };

  // Fetch client email
  const clientRes = await dbPool.query(
    `SELECT email FROM clients WHERE client_id = $1`,
    [clientId]
  );

  if (clientRes.rowCount === 0) {
    logMessage("ClientCommunicationAgent", `Client ${clientId} not found in database.`);
    return;
  }

  const clientEmail = clientRes.rows[0].email;
  meetingDetails.attendees.push({ email: clientEmail });

  // Create Google Calendar event
  await createCalendarEvent({
    summary: meetingDetails.summary,
    location: meetingDetails.location,
    description: meetingDetails.description,
    start: {
      dateTime: meetingDetails.startTime,
      timeZone: 'America/Los_Angeles',
    },
    end: {
      dateTime: meetingDetails.endTime,
      timeZone: 'America/Los_Angeles',
    },
    attendees: meetingDetails.attendees,
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 24 * 60 },
        { method: 'popup', minutes: 10 },
      ],
    },
  });

  // Send confirmation email to the client
  const subject = "Meeting Scheduled";
  const response = `Your meeting has been scheduled. Please check your Google Calendar for details.`;

  await sendEmail(clientEmail, subject, response);

  // Send Slack notification to the team
  const slackNotification = `Scheduled a meeting with client ${clientId}.`;
  await sendSlackMessage(slackNotification);

  // Record the meeting communication
  const meetingCommunication: DataProduct<ClientCommunication> = {
    name: "client-communication",
    schemaVersion: "1.0.0",
    timestamp: Date.now(),
    payload: {
      clientId,
      message: response,
      timestamp: Date.now()
    }
  };

  if (channel) {
    channel.sendToQueue('agent_communication', Buffer.from(JSON.stringify({
      type: 'client_email_response',
      data: meetingCommunication
    })), { persistent: true });
    logMessage("ClientCommunicationAgent", `Published client_email_response event for client ${clientId}`);
  }

  sendMetric("ai_agent.client_communication.meetings_scheduled", 1, [`agent:client-communication`, `client:${clientId}`]);
}

// Start Express server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  logMessage("ClientCommunicationAgent", `Gmail Inbound listener started on port ${PORT}`);
});

// Consume events from RabbitMQ
import amqp from 'amqplib';

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
    logMessage("ClientCommunicationAgent", "Started consuming events from RabbitMQ");
  } catch (error) {
    logMessage("ClientCommunicationAgent", `Error consuming events: ${error}`);
    process.exit(1);
  }
}

consumeEvents();
