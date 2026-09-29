import { buildCompanionSystemPrompt } from "./persona.js";
import { generateCompanionReply } from "./llm.js";
import { logConversation, getRecentConversation } from "./db.js";
import { reminderToolDeclarations, executeReminderTool } from "./actions/reminderActions.js";

const HISTORY_TURNS = 20;
const TOOLS = [...reminderToolDeclarations];

function toolExecutor(name, args) {
  return executeReminderTool(name, args);
}

export async function handleCompanionMessage(incomingText) {
  logConversation("user", incomingText);

  const history = getRecentConversation(HISTORY_TURNS).map((row) => ({
    role: row.role,
    content: row.content,
  }));

  const systemPrompt = buildCompanionSystemPrompt({ toolsEnabled: true });
  const { text } = await generateCompanionReply({
    systemPrompt,
    history,
    tools: TOOLS,
    toolExecutor,
  });

  if (text) logConversation("companion", text);
  return text;
}
