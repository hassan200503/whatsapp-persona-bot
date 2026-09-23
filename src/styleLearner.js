// This is the "learns you" piece. Every message YOU send from your own phone
// (not the bot's auto-replies) gets appended here. Over days/weeks this file
// becomes a real corpus of your actual voice, which persona.js samples from
// when building the system prompt — so the bot keeps sounding more like you
// the longer it runs, without you doing anything extra.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
export const STYLE_LOG_PATH = path.join(dataDir, "style-log.jsonl");

const MAX_LOGGED_MESSAGES = 2000; // keep the file from growing unbounded

export function recordOwnMessage(text) {
  if (!text || typeof text !== "string") return;
  const trimmed = text.trim();
  // Skip junk: empty, pure media placeholders, or bot commands.
  if (!trimmed || trimmed.startsWith("/")) return;
  const entry = JSON.stringify({ text: trimmed, at: new Date().toISOString() });
  fs.appendFileSync(STYLE_LOG_PATH, entry + "\n", "utf8");
}

// Returns up to `count` recent real messages, sampled to fit a token budget,
// for use as few-shot examples in the system prompt.
export function sampleOwnMessages(count = 25) {
  if (!fs.existsSync(STYLE_LOG_PATH)) return [];
  const lines = fs
    .readFileSync(STYLE_LOG_PATH, "utf8")
    .split("\n")
    .filter(Boolean);

  // Trim the file on disk if it's grown too large, keeping the most recent.
  if (lines.length > MAX_LOGGED_MESSAGES) {
    const trimmed = lines.slice(-MAX_LOGGED_MESSAGES);
    fs.writeFileSync(STYLE_LOG_PATH, trimmed.join("\n") + "\n", "utf8");
  }

  const recent = lines.slice(-Math.max(count * 4, count)); // pool to sample from
  const parsed = recent
    .map((l) => {
      try {
        return JSON.parse(l).text;
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  // Prefer variety: dedupe near-identical short messages, then take the
  // most recent `count`.
  const seen = new Set();
  const deduped = [];
  for (const msg of parsed.reverse()) {
    const key = msg.toLowerCase().slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(msg);
    if (deduped.length >= count) break;
  }
  return deduped.reverse();
}

export function styleLogSize() {
  if (!fs.existsSync(STYLE_LOG_PATH)) return 0;
  return fs.readFileSync(STYLE_LOG_PATH, "utf8").split("\n").filter(Boolean).length;
}
