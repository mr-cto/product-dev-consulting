/**
 * @product-dev-consulting/client-portal
 *
 * Provides a web-based portal for clients to submit requests, view project statuses, and schedule meetings.
 */
import express from 'express';
import { dbPool, logMessage, sendMetric, setupRabbitMQ } from "@product-dev-consulting/common";
import bodyParser from 'body-parser';
import { v4 as uuidv4 } from 'uuid';
import amqp from 'amqplib';
import path from 'path';

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Set view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// RabbitMQ setup
let channel;
setupRabbitMQ().then((ch) => {
  channel = ch;
  logMessage("ClientPortal", "Connected to RabbitMQ");
}).catch(err => {
  logMessage("ClientPortal", `Error connecting to RabbitMQ: ${err}`);
  process.exit(1);
});

// Routes
app.get('/', (req, res) => {
  res.render('index');
});

app.post('/submit-request', async (req, res) => {
  const { clientEmail, projectTitle, projectDescription } = req.body;

  if (!clientEmail || !projectTitle || !projectDescription) {
    res.status(400).send('All fields are required.');
    return;
  }

  // Generate client ID or fetch existing
  let clientId = await getClientIdByEmail(clientEmail);
  if (!clientId) {
    clientId = `client-${uuidv4()}`;
    await dbPool.query(
      `INSERT INTO clients (client_id, name, email, phone, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [clientId, clientEmail.split('@')[0], clientEmail, null]
    );
  }

  // Create project
  const projectId = `project-${uuidv4()}`;
  await dbPool.query(
    `INSERT INTO projects (project_id, client_id_ref, name, description, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'active', NOW(), NOW())`,
    [projectId, clientId, projectTitle, projectDescription]
  );

  // Publish event to RabbitMQ
  if (channel) {
    channel.sendToQueue('agent_communication', Buffer.from(JSON.stringify({
      type: 'new_project_request',
      data: {
        projectId,
        clientId,
        projectTitle,
        projectDescription,
        timestamp: Date.now()
      }
    })), { persistent: true });
    logMessage("ClientPortal", `Published new_project_request event for project ${projectId}`);
  }

  sendMetric("ai_agent.client_portal.requests_submitted", 1, [`agent:client-portal`, `project:${projectId}`]);

  res.status(200).send('Project request submitted successfully.');
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
    logMessage("ClientPortal", "Started consuming events from RabbitMQ");
  } catch (error) {
    logMessage("ClientPortal", `Error consuming events: ${error}`);
    process.exit(1);
  }
}

// Function to handle incoming events (if needed)
async function handleEvent(event: any) {
  // Implement any client portal specific event handling here
  logMessage("ClientPortal", `Received event: ${event.type}`);
}

// Initialize event consumption
consumeEvents();

// Start Express server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  logMessage("ClientPortal", `Client portal started on port ${PORT}`);
});
