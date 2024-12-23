/**
 * @product-dev-consulting/support-agent
 *
 * Handles client support tickets and inquiries using Zendesk.
 */
import { dbPool, logMessage, DataProduct, SupportTicket, sendMetric, setupRabbitMQ } from "@product-dev-consulting/common";
import axios from "axios";
import amqp from 'amqplib';

const {
  ZENDESK_SUBDOMAIN,
  ZENDESK_EMAIL,
  ZENDESK_API_TOKEN
} = process.env;

// Validate Zendesk environment variables
if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
  throw new Error("Missing Zendesk configuration in environment variables.");
}

// Initialize Axios for Zendesk API
const zendeskApi = axios.create({
  baseURL: `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2`,
  auth: {
    username: `${ZENDESK_EMAIL}/token`,
    password: ZENDESK_API_TOKEN
  }
});

// RabbitMQ setup
let channel;
setupRabbitMQ().then((ch) => {
  channel = ch;
  logMessage("SupportAgent", "Connected to RabbitMQ");
}).catch(err => {
  logMessage("SupportAgent", `Error connecting to RabbitMQ: ${err}`);
  process.exit(1);
});

// Function to handle incoming events
async function handleEvent(event: any) {
  switch(event.type) {
    case 'support_ticket_created':
      await handleNewSupportTicket(event.data);
      break;
    // Add more event types as needed
    default:
      logMessage("SupportAgent", `Unhandled event type: ${event.type}`);
  }
}

// Function to handle new support tickets
async function handleNewSupportTicket(ticket: SupportTicket) {
  logMessage("SupportAgent", `Handling new support ticket ${ticket.ticketId} from client ${ticket.clientId}`);

  // Simulate resolving the ticket (replace with actual resolution logic)
  const resolution = `Issue "${ticket.issue}" has been resolved. Thank you for contacting us.`;

  // Resolve the ticket in Zendesk
  await resolveSupportTicketZendesk(ticket.ticketId, resolution);

  // Update ticket status in the database
  await updateTicketStatus(ticket.ticketId, "resolved");

  // Record the resolution in the database
  await recordResolution(ticket.ticketId, resolution);

  sendMetric("ai_agent.support.tickets_resolved", 1, [`agent:support`, `ticket:${ticket.ticketId}`]);
}

// Function to resolve a support ticket in Zendesk
async function resolveSupportTicketZendesk(ticketId: string, resolution: string) {
  try {
    await zendeskApi.put(`/tickets/${ticketId}.json`, {
      ticket: {
        status: "closed",
        comment: {
          body: resolution
        }
      }
    });
    logMessage("SupportAgent", `Resolved Zendesk ticket ${ticketId}: ${resolution}`);
  } catch (error: any) {
    logMessage("SupportAgent", `Error resolving Zendesk ticket ${ticketId}: ${error.message}`);
    throw error;
  }
}

// Function to update ticket status in the database
async function updateTicketStatus(ticketId: string, status: string) {
  await dbPool.query(
    `UPDATE support_tickets
     SET status = $1, updated_at = NOW()
     WHERE ticket_id = $2`,
    [status, ticketId]
  );

  sendMetric("ai_agent.support.tickets_resolved", 1, [`agent:support`, `ticket:${ticketId}`]);
}

// Function to record resolution in the database
async function recordResolution(ticketId: string, resolution: string) {
  await dbPool.query(
    `INSERT INTO support_resolutions (resolution_id, ticket_id_ref, resolution, timestamp, created_at, updated_at)
     VALUES ('res-' || nextval('support_resolutions_id_seq'), $1, $2, to_timestamp($3 / 1000.0), NOW(), NOW())`,
    [ticketId, resolution, Date.now()]
  );
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
    logMessage("SupportAgent", "Started consuming events from RabbitMQ");
  } catch (error) {
    logMessage("SupportAgent", `Error consuming events: ${error}`);
    process.exit(1);
  }
}

// Main function to handle support tickets
async function runSupportAgent() {
  logMessage("SupportAgent", "Listening for support tickets...");
  await consumeEvents();
}

// Initialize
runSupportAgent().catch((err) => {
  logMessage("SupportAgent", `Error: ${err}`);
  process.exit(1);
});
