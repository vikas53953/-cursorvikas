// SMTP email sending for reports and Kanban cards.

const path = require("node:path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

function smtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;
  if (!host || !user || !pass) return null;
  return { host, port, user, pass, from };
}

async function sendEmail({ to, subject, body, html }) {
  const config = smtpConfig();
  if (!config) {
    return {
      ok: false,
      error: "SMTP is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS (and optionally SMTP_PORT, SMTP_FROM) in .env.local.",
    };
  }

  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch {
    return { ok: false, error: "nodemailer is not installed. Run npm install." };
  }

  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
  });

  const info = await transport.sendMail({
    from: config.from,
    to,
    subject,
    text: body,
    html: html || undefined,
  });

  return { ok: true, messageId: info.messageId, to, subject };
}

module.exports = { sendEmail, smtpConfig };
