// Makes the companion proactive: delivers reminders when they're due, and
// once a day reflects on that day's conversation into durable memory so it
// keeps "growing" without needing a human to manually curate its memory.

import cron from "node-cron";
import {
  getDueReminders,
  setReminderStatus,
  getConversationSince,
  trimConversationBefore,
  saveJournalEntry,
  addFact,
} from "./db.js";
import { generateCompanionReply } from "./llm.js";
import { logger } from "../logger.js";

const REMINDER_CHECK_CRON = "*/5 * * * *";
const NIGHTLY_REFLECTION_CRON = process.env.NIGHTLY_REFLECTION_CRON || "55 23 * * *";
const ENABLE_DAILY_CHECKIN = String(process.env.ENABLE_DAILY_CHECKIN || "false").toLowerCase() === "true";
const DAILY_CHECKIN_CRON = process.env.DAILY_CHECKIN_CRON || "0 8 * * *";

let tasks = [];
let sendToOwner = null; // (text) => Promise<void>, set by initScheduler

// Called once the WhatsApp connection is up (and again on reconnect — safe
// to call repeatedly, it replaces the previous schedule rather than
// stacking duplicate jobs).
export function initScheduler(sendMessageFn) {
  for (const t of tasks) t.stop();
  tasks = [];
  sendToOwner = sendMessageFn;

  tasks.push(cron.schedule(REMINDER_CHECK_CRON, () => checkDueReminders().catch(logReminderError)));
  tasks.push(cron.schedule(NIGHTLY_REFLECTION_CRON, () => runNightlyReflection().catch(logReflectionError)));
  if (ENABLE_DAILY_CHECKIN) {
    tasks.push(cron.schedule(DAILY_CHECKIN_CRON, () => sendDailyCheckin().catch(logCheckinError)));
  }

  logger.info(
    { nightlyReflection: NIGHTLY_REFLECTION_CRON, dailyCheckin: ENABLE_DAILY_CHECKIN },
    "Companion scheduler started"
  );
}

function logReminderError(err) {
  logger.error({ err: err?.message }, "Reminder delivery failed");
}
function logReflectionError(err) {
  logger.error({ err: err?.message }, "Nightly reflection failed");
}
function logCheckinError(err) {
  logger.error({ err: err?.message }, "Daily check-in failed");
}

async function checkDueReminders() {
  const due = getDueReminders();
  for (const reminder of due) {
    await sendToOwner(`⏰ ${reminder.text}`);
    setReminderStatus(reminder.id, "done");
    logger.info({ reminderId: reminder.id }, "Reminder delivered");
  }
}

// Reads today's companion conversation, asks the brain to summarize it and
// pull out anything durable worth remembering, and saves that to the
// journal + facts tables. Trims the raw transcript afterward so the
// conversation_log table doesn't grow forever.
export async function runNightlyReflection() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  // Local calendar date, not startOfDay.toISOString().slice(0, 10) — that
  // converts to UTC first and rolls back a day for any timezone ahead of
  // UTC (e.g. EAT, UTC+3), mislabeling today's reflection as yesterday's.
  const today = `${startOfDay.getFullYear()}-${String(startOfDay.getMonth() + 1).padStart(2, "0")}-${String(startOfDay.getDate()).padStart(2, "0")}`;

  const turns = getConversationSince(startOfDay.toISOString());
  if (turns.length === 0) {
    logger.info("Nightly reflection: no conversation today, skipping");
    return;
  }

  const transcript = turns.map((t) => `${t.role}: ${t.content}`).join("\n");
  const reflectionPrompt = `You are reflecting privately on today's conversation with the owner (this is not sent to them). Read the transcript and respond with ONLY a JSON object, no other text, shaped like:
{"summary": "1-3 sentence summary of today's conversation and how the owner seemed", "facts": [{"category": "interest|goal|relationship|preference|identity", "value": "a short durable fact worth remembering long-term"}]}
Only include facts that are genuinely new and durable — not small talk. If nothing durable came up, use an empty facts array.

Transcript:
${transcript}`;

  const { text } = await generateCompanionReply({
    systemPrompt: "You output only valid JSON, nothing else.",
    history: [{ role: "user", content: reflectionPrompt }],
    tools: [],
  });

  let parsed;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    logger.warn("Nightly reflection: could not parse JSON, saving raw text as summary");
    parsed = { summary: text.slice(0, 500), facts: [] };
  }

  saveJournalEntry(today, parsed.summary || "(no summary)");
  for (const fact of parsed.facts || []) {
    if (fact?.value) addFact(fact.category || "identity", fact.value, "nightly-reflection");
  }
  trimConversationBefore(startOfDay.toISOString());

  logger.info(
    { day: today, factsLearned: parsed.facts?.length || 0 },
    "Nightly reflection complete"
  );
}

async function sendDailyCheckin() {
  const { text } = await generateCompanionReply({
    systemPrompt:
      "Write a short, warm good-morning check-in message to the owner, in character. One or two sentences, WhatsApp-natural. No preamble, just the message itself.",
    history: [{ role: "user", content: "(no incoming message — you're initiating a daily check-in)" }],
    tools: [],
  });
  if (text) await sendToOwner(text);
}
