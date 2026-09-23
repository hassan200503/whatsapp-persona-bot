import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "./persona.js";
import { logger } from "./logger.js";

let client = null;
function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key from https://console.anthropic.com/"
      );
    }
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

// Keeps a short rolling conversation history per chat so replies stay
// coherent across a back-and-forth, without ever growing unbounded.
const conversationHistory = new Map(); // chatId -> [{role, content}]
const MAX_TURNS = 10;

export async function generateReply({ chatId, incomingText, senderName }) {
  const anthropic = getClient();
  const model = process.env.CLAUDE_MODEL || "claude-sonnet-4-5";

  const history = conversationHistory.get(chatId) || [];
  const userTurn = {
    role: "user",
    content: senderName ? `${senderName}: ${incomingText}` : incomingText,
  };
  const messages = [...history, userTurn];

  const response = await anthropic.messages.create({
    model,
    max_tokens: 400,
    system: buildSystemPrompt(),
    messages,
  });

  const replyText = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  const updatedHistory = [...messages, { role: "assistant", content: replyText }].slice(
    -MAX_TURNS * 2
  );
  conversationHistory.set(chatId, updatedHistory);

  logger.debug({ chatId, model }, "generated auto-reply");
  return replyText;
}

export function clearHistory(chatId) {
  conversationHistory.delete(chatId);
}
