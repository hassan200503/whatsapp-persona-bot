import pino from "pino";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logsDir = path.join(__dirname, "..", "logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

// Logs to both the console (pretty) and a file (raw JSON, so you can audit
// everything the bot ever sent while you were away).
export const logger = pino(
  { level: process.env.LOG_LEVEL || "info" },
  pino.transport({
    targets: [
      {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:standard" },
        level: process.env.LOG_LEVEL || "info",
      },
      {
        target: "pino/file",
        options: { destination: path.join(logsDir, "bot.log") },
        level: "info",
      },
    ],
  })
);

// Separate, human-readable audit trail of every auto-sent message —
// this is the file to check "what did the bot say while I was out".
const auditPath = path.join(logsDir, "auto-replies.log");
export function auditAutoReply({ chatId, chatName, incoming, outgoing }) {
  const line = `[${new Date().toISOString()}] TO: ${chatName || chatId}\n  THEM: ${incoming}\n  BOT:  ${outgoing}\n\n`;
  fs.appendFileSync(auditPath, line, "utf8");
}
