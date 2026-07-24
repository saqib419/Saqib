const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function draftReply({ question, menteeName, subject }) {
  const prompt = `You are helping a medical exam mentor draft a short, encouraging reply to their mentee's question.

Mentee: ${menteeName || 'the student'}
Subject: ${subject || 'general'}
Question: ${question}

Write a concise, warm, mentor-style draft reply (3-5 sentences). Do not add a greeting or signature.`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

module.exports = { draftReply };
