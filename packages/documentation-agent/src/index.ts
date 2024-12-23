/**
 * @product-dev-consulting/documentation-agent
 *
 * Manages project and client documentation, ensuring all documentation is up-to-date and accessible using Confluence.
 */
import { dbPool, logMessage, DataProduct, Documentation, sendMetric, setupRabbitMQ } from "@product-dev-consulting/common";
import axios from "axios";
import amqp from 'amqplib';

const {
  CONFLUENCE_BASE_URL,
  CONFLUENCE_API_TOKEN,
  CONFLUENCE_USER_EMAIL
} = process.env;

// Validate Confluence environment variables
if (!CONFLUENCE_BASE_URL || !CONFLUENCE_API_TOKEN || !CONFLUENCE_USER_EMAIL) {
  throw new Error("Missing Confluence configuration in environment variables.");
}

// Initialize Axios for Confluence API
const confluenceApi = axios.create({
  baseURL: CONFLUENCE_BASE_URL,
  headers: {
    'Authorization': `Basic ${Buffer.from(`${CONFLUENCE_USER_EMAIL}:${CONFLUENCE_API_TOKEN}`).toString('base64')}`,
    'Content-Type': 'application/json'
  }
});

// RabbitMQ setup
let channel;
setupRabbitMQ().then((ch) => {
  channel = ch;
  logMessage("DocumentationAgent", "Connected to RabbitMQ");
}).catch(err => {
  logMessage("DocumentationAgent", `Error connecting to RabbitMQ: ${err}`);
  process.exit(1);
});

// Function to handle incoming events
async function handleEvent(event: any) {
  switch(event.type) {
    case 'client_email_response':
      // Potentially handle responses if needed
      break;
    case 'project_management_task_created':
      // Potentially handle project management events
      break;
    case 'documentation_update':
      await handleDocumentationUpdate(event.data);
      break;
    // Add more event types as needed
    default:
      logMessage("DocumentationAgent", `Unhandled event type: ${event.type}`);
  }
}

// Function to handle documentation updates
async function handleDocumentationUpdate(data: any) {
  const { documentId, projectId, content, timestamp } = data;

  logMessage("DocumentationAgent", `Processing documentation update for project ${projectId}: ${documentId}`);

  // Update documentation in Confluence
  await updateConfluenceDocument({
    documentId,
    projectId,
    content,
    timestamp
  });

  // Mark documentation as processed
  await markDocumentationAsProcessed(documentId);

  sendMetric("ai_agent.documentation.documents_updated", 1, [`agent:documentation`, `project:${projectId}`]);
}

// Function to update documentation in Confluence
async function updateConfluenceDocument(doc: Documentation) {
  try {
    // Fetch the Confluence page ID based on projectId (assumes a mapping exists)
    const { data: pageData } = await confluenceApi.get(`/rest/api/content`, {
      params: {
        title: `Project Documentation: ${doc.projectId}`,
        spaceKey: "DEV"
      }
    });

    if (pageData.results.length === 0) {
      // Create a new page if it doesn't exist
      const createResponse = await confluenceApi.post(`/rest/api/content`, {
        type: "page",
        title: `Project Documentation: ${doc.projectId}`,
        space: { key: "DEV" },
        body: {
          storage: {
            value: `<p>${doc.content}</p>`,
            representation: "storage"
          }
        }
      });
      logMessage("DocumentationAgent", `Created new Confluence page for project ${doc.projectId}`);
    } else {
      // Update existing page
      const pageId = pageData.results[0].id;
      const version = pageData.results[0].version.number + 1;

      await confluenceApi.put(`/rest/api/content/${pageId}`, {
        id: pageId,
        type: "page",
        title: `Project Documentation: ${doc.projectId}`,
        space: { key: "DEV" },
        body: {
          storage: {
            value: `<p>${doc.content}</p>`,
            representation: "storage"
          }
        },
        version: { number: version }
      });
      logMessage("DocumentationAgent", `Updated Confluence page for project ${doc.projectId}`);
    }
  } catch (error: any) {
    logMessage("DocumentationAgent", `Error updating Confluence document: ${error.message}`);
    throw error;
  }
}

// Function to mark documentation as processed
async function markDocumentationAsProcessed(docId: string) {
  await dbPool.query(
    `UPDATE documents
     SET processed = true, updated_at = NOW()
     WHERE document_id = $1`,
    [docId]
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
    logMessage("DocumentationAgent", "Started consuming events from RabbitMQ");
  } catch (error) {
    logMessage("DocumentationAgent", `Error consuming events: ${error}`);
    process.exit(1);
  }
}

// Main function to handle documentation updates
async function runDocumentation() {
  logMessage("DocumentationAgent", "Listening for documentation updates...");
  await consumeEvents();
}

// Initialize
runDocumentation().catch((err) => {
  logMessage("DocumentationAgent", `Error: ${err}`);
  process.exit(1);
});
