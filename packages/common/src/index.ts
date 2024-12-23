/**
 * @product-dev-consulting/common
 *
 * Shared logic, data contract definitions, environment variables, and utility functions.
 */
import * as dotenv from "dotenv";
dotenv.config(); // Load .env into process.env

import { Pool } from "pg";
import StatsD from "hot-shots";
import amqp from 'amqplib';
import { google } from 'googleapis';
import nodemailer from 'nodemailer';

// Load environment variables
const {
  POSTGRES_HOST,
  POSTGRES_PORT,
  POSTGRES_USER,
  POSTGRES_PASSWORD,
  POSTGRES_DB,
  NODE_ENV,
  DATADOG_API_KEY,
  DATADOG_APP_KEY,
  DATADOG_SITE,
  DATADOG_SERVICE,
  RABBITMQ_URL,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  GOOGLE_REFRESH_TOKEN,
  GOOGLE_CALENDAR_ID
} = process.env;

// Validate required variables
if (!POSTGRES_HOST || !POSTGRES_USER || !POSTGRES_PASSWORD || !POSTGRES_DB) {
  throw new Error("Missing required PostgreSQL environment variables in .env");
}

// Setup PostgreSQL pool
export const dbPool = new Pool({
  host: POSTGRES_HOST,
  port: Number(POSTGRES_PORT || 5432),
  user: POSTGRES_USER,
  password: POSTGRES_PASSWORD,
  database: POSTGRES_DB
});

// Data product interfaces
export interface DataProduct<T> {
  name: string;
  schemaVersion: string;
  timestamp: number;
  payload: T;
}

// Example data contracts
export interface ClientCommunication {
  clientId: string;
  message: string;
  timestamp: number;
}

export interface ProjectManagement {
  projectId: string;
  task: string;
  assignedTo: string;
  status: string;
  deadline: number;
}

export interface DevelopmentTask {
  taskId: string;
  description: string;
  assignedTo: string;
  status: string;
  repositoryUrl: string;
}

export interface TestingResult {
  testId: string;
  taskId: string;
  passed: boolean;
  timestamp: number;
}

export interface DeploymentInfo {
  deploymentId: string;
  taskId: string;
  environment: string;
  status: string;
  timestamp: number;
}

export interface InternalCommunication {
  employeeId: string;
  message: string;
  timestamp: number;
}

export interface Documentation {
  documentId: string;
  projectId: string;
  content: string;
  timestamp: number;
}

export interface SupportTicket {
  ticketId: string;
  clientId: string;
  issue: string;
  status: string;
  timestamp: number;
}

// Utility Logger
export function logMessage(agentName: string, message: string) {
  const now = new Date().toISOString();
  console.log(`[${now}][${agentName}] ${message}`);
}

// Datadog StatsD client
export const dogstatsd = new StatsD({
  host: "datadog-agent",
  port: 8125,
  globalTags: { service: DATADOG_SERVICE || "product-dev-consulting" }
});

/**
 * Send a Datadog metric
 */
export function sendMetric(metricName: string, value: number, tags?: string[]) {
  dogstatsd.gauge(metricName, value, tags);
  logMessage("Common", `Datadog metric [${metricName}] = ${value}`);
}

// RabbitMQ Setup
export async function setupRabbitMQ() {
  if (!RABBITMQ_URL) {
    throw new Error("Missing RabbitMQ URL in environment variables.");
  }
  const connection = await amqp.connect(RABBITMQ_URL);
  const channel = await connection.createChannel();
  await channel.assertQueue('agent_communication', { durable: true });
  return channel;
}

// Google Workspace (Gmail) Setup
export const gmail = google.gmail('v1');

export const oAuth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI
);

oAuth2Client.setCredentials({
  refresh_token: GOOGLE_REFRESH_TOKEN
});

// Nodemailer Transporter using Gmail
export const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    type: 'OAuth2',
    user: `no-reply@${process.env.DOMAIN_NAME}`,
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    refreshToken: GOOGLE_REFRESH_TOKEN,
    accessToken: oAuth2Client.getAccessToken()
  }
});

/**
 * Send an email using Gmail
 */
export async function sendEmail(to: string, subject: string, text: string, html?: string) {
  const mailOptions = {
    from: `No Reply <no-reply@${process.env.DOMAIN_NAME}>`,
    to,
    subject,
    text,
    html
  };
  
  await transporter.sendMail(mailOptions);
  logMessage("Common", `Email sent to ${to}: ${subject}`);
}

/**
 * Create a Google Calendar event
 */
export async function createCalendarEvent(event: any) {
  const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
  
  const res = await calendar.events.insert({
    calendarId: GOOGLE_CALENDAR_ID,
    requestBody: event
  });
  
  logMessage("Common", `Calendar event created: ${res.data.htmlLink}`);
}

