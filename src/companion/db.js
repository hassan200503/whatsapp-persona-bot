// Local, file-based memory for the companion. One SQLite file, no external
// service — the only thing that ever reads or writes it is this Node
// process, which already serves every device through the WhatsApp self-chat.

import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, "companion.db"));
db.exec("PRAGMA journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    value TEXT NOT NULL,
    source TEXT,
    created_at TEXT NOT NULL,
    superseded_by INTEGER
  );

  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    due_at TEXT,
    recurrence TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS journal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL UNIQUE,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversation_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    at TEXT NOT NULL
  );
`);

// ---- facts ----
const insertFact = db.prepare(
  "INSERT INTO facts (category, value, source, created_at) VALUES (?, ?, ?, ?)"
);
export function addFact(category, value, source = "conversation") {
  return insertFact.run(category, value, source, new Date().toISOString()).lastInsertRowid;
}

const recentFactsStmt = db.prepare(
  "SELECT * FROM facts WHERE superseded_by IS NULL ORDER BY created_at DESC LIMIT ?"
);
export function getRecentFacts(limit = 50) {
  return recentFactsStmt.all(limit);
}

// ---- reminders ----
const insertReminder = db.prepare(
  "INSERT INTO reminders (text, due_at, recurrence, status, created_at) VALUES (?, ?, ?, 'pending', ?)"
);
export function addReminder(text, dueAt = null, recurrence = null) {
  return insertReminder.run(text, dueAt, recurrence, new Date().toISOString()).lastInsertRowid;
}

const dueRemindersStmt = db.prepare(
  "SELECT * FROM reminders WHERE status = 'pending' AND due_at IS NOT NULL AND due_at <= ? ORDER BY due_at ASC"
);
export function getDueReminders(now = new Date().toISOString()) {
  return dueRemindersStmt.all(now);
}

const pendingRemindersStmt = db.prepare(
  "SELECT * FROM reminders WHERE status = 'pending' ORDER BY (due_at IS NULL), due_at ASC LIMIT ?"
);
export function getPendingReminders(limit = 20) {
  return pendingRemindersStmt.all(limit);
}

const setReminderStatusStmt = db.prepare("UPDATE reminders SET status = ? WHERE id = ?");
export function setReminderStatus(id, status) {
  setReminderStatusStmt.run(status, id);
}

// ---- journal (nightly reflection) ----
const upsertJournalStmt = db.prepare(`
  INSERT INTO journal (day, summary, created_at) VALUES (?, ?, ?)
  ON CONFLICT(day) DO UPDATE SET summary = excluded.summary
`);
export function saveJournalEntry(day, summary) {
  upsertJournalStmt.run(day, summary, new Date().toISOString());
}

const recentJournalStmt = db.prepare("SELECT * FROM journal ORDER BY day DESC LIMIT ?");
export function getRecentJournal(limit = 7) {
  return recentJournalStmt.all(limit);
}

// ---- conversation log ----
const insertLog = db.prepare("INSERT INTO conversation_log (role, content, at) VALUES (?, ?, ?)");
export function logConversation(role, content) {
  insertLog.run(role, content, new Date().toISOString());
}

const recentLogStmt = db.prepare("SELECT * FROM conversation_log ORDER BY id DESC LIMIT ?");
export function getRecentConversation(limit = 30) {
  return recentLogStmt.all(limit).reverse();
}

const logSinceStmt = db.prepare("SELECT * FROM conversation_log WHERE at >= ? ORDER BY id ASC");
export function getConversationSince(isoTimestamp) {
  return logSinceStmt.all(isoTimestamp);
}

const trimLogStmt = db.prepare("DELETE FROM conversation_log WHERE at < ?");
export function trimConversationBefore(isoTimestamp) {
  trimLogStmt.run(isoTimestamp);
}

export default db;
