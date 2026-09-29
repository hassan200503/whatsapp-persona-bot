import { buildCompanionSystemPrompt } from "./persona.js";
import { generateCompanionReply } from "./llm.js";
import { logConversation, getRecentConversation } from "./db.js";

const HISTORY_TURNS = 20;

export async function handleCompanionMessage(incomingText) {
  logConversation("user", incomingText);

  const history = getRecentConversation(HISTORY_TURNS).map((row) => ({
    role: row.role,
    content: row.content,
  }));

  const systemPrompt = buildCompanionSystemPrompt({ toolsEnabled: false });
  const { text } = await generateCompanionReply({ systemPrompt, history, tools: [] });

  if (text) logConversation("companion", text);
  return text;
}
