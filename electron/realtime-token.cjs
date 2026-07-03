// Mints a short-lived OpenAI Realtime client secret with the NetJarvis
// persona and tool set. Shared by the Electron main process and the web
// server so browser and desktop sessions behave identically.

const crypto = require("node:crypto");
const logger = require("./logger.cjs");

async function createRealtimeToken({ instructions, toolSpecs }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.log("realtime.token.error", { error: "OPENAI_API_KEY missing" });
    throw new Error("OPENAI_API_KEY is missing in .env.local");
  }

  const started = Date.now();
  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": crypto.createHash("sha256").update("netjarvis-local").digest("hex"),
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: "gpt-realtime-2",
        instructions,
        output_modalities: ["audio"],
        reasoning: { effort: "low" },
        tool_choice: "auto",
        tools: toolSpecs,
        audio: {
          input: {
            turn_detection: {
              type: "semantic_vad",
              eagerness: "medium",
              create_response: true,
              interrupt_response: true,
            },
          },
          output: {
            voice: "cedar",
          },
        },
        tracing: {
          workflow_name: "NetJarvis NOC Copilot",
        },
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    logger.log("realtime.token.error", { status: response.status, body: text.slice(0, 300), ms: Date.now() - started });
    throw new Error(`Realtime token request failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  const value = data.value || data.client_secret?.value;
  if (!value) {
    logger.log("realtime.token.error", { error: "no client secret in response", ms: Date.now() - started });
    throw new Error("Realtime token response did not include a client secret value.");
  }
  const expiresAt = data.expires_at || data.client_secret?.expires_at || null;
  logger.log("realtime.token.ok", { expiresAt, ms: Date.now() - started });
  return { value, expiresAt };
}

module.exports = { createRealtimeToken };
