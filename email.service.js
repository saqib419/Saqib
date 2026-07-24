// Minimal email sender for transactional messages (currently: password
// reset). Uses SMTP if configured via env vars; otherwise falls back to
// logging the message to the server console so local development and
// review environments don't need real SMTP creds to exercise the flow.
//
// Requires 'nodemailer' — add it to package.json dependencies:
//   npm install nodemailer

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return null; // not configured — caller falls back to console logging
  }

  const nodemailer = require('nodemailer');
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

async function sendMail({ to, subject, text, html }) {
  const t = getTransporter();

  if (!t) {
    // Local-dev / unconfigured fallback — never silently drop the
    // message, make it visible in logs so the flow is still testable.
    console.log('─────────────────────────────────────────────');
    console.log('📧  SMTP not configured — email logged instead of sent');
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(text);
    console.log('─────────────────────────────────────────────');
    return { delivered: false, loggedOnly: true };
  }

  await t.sendMail({
    from: process.env.SMTP_FROM || 'MedClarivo <no-reply@medclarivo.com>',
    to,
    subject,
    text,
    html,
  });
  return { delivered: true, loggedOnly: false };
}

async function sendPasswordResetEmail(user, resetUrl) {
  return sendMail({
    to: user.email,
    subject: 'Reset your MedClarivo password',
    text:
      `Hi ${user.name || 'there'},\n\n` +
      `We received a request to reset your MedClarivo password. This link expires in 30 minutes:\n\n` +
      `${resetUrl}\n\n` +
      `If you didn't request this, you can safely ignore this email — your password won't change.`,
    html:
      `<p>Hi ${user.name || 'there'},</p>` +
      `<p>We received a request to reset your MedClarivo password. This link expires in 30 minutes:</p>` +
      `<p><a href="${resetUrl}">${resetUrl}</a></p>` +
      `<p>If you didn't request this, you can safely ignore this email — your password won't change.</p>`,
  });
}

module.exports = { sendMail, sendPasswordResetEmail };
