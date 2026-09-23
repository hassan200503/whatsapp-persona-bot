import "dotenv/config";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import qrcodeTerminal from "qrcode-terminal";
import QRCode from "qrcode";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";

import { logger, auditAutoReply } from "./logger.js";
import { generateReply, clearHistory } from "./replyEngine.js";
import { recordOwnMessage, styleLogSize } from "./styleLearner.js";
import { canReply, recordReply, randomDelayMs } from "./rateLimiter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.join(__dirname, "..", "auth");
const QR_IMAGE_PATH = path.join(__dirname, "..", "latest-qr.png");

// ---- Runtime, editable-without-restart settings ----
let AWAY_MODE = String(process.env.AWAY_MODE || "true").toLowerCase() === "true";
const TOGGLE_KEYWORD = process.env.TOGGLE_KEYWORD || "/awaytoggle";
const IGNORE_NUMBERS = new Set(
  (process.env.IGNORE_NUMBERS || "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean)
);
const REPLY_IN_GROUPS = String(process.env.REPLY_IN_GROUPS || "false").toLowerCase() === "true";
const MIN_DELAY = Number(process.env.MIN_REPLY_DELAY_SECONDS || 8);
const MAX_DELAY = Number(process.env.MAX_REPLY_DELAY_SECONDS || 35);
const MAX_PER_HOUR = Number(process.env.MAX_REPLIES_PER_CHAT_PER_HOUR || 6);

let reconnectAttempts = 0;

function extractText(message) {
  if (!message) return null;
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    null
  );
}

async function start() {
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: logger.child({ module: "baileys" }, { level: "warn" }),
    printQRInTerminal: false, // we handle QR ourselves below (terminal + image file)
    browser: ["Persona Bot", "Chrome", "1.0.0"],
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      logger.info("Scan this QR code with WhatsApp (Linked Devices) on your phone:");
      qrcodeTerminal.generate(qr, { small: true });
      try {
        await QRCode.toFile(QR_IMAGE_PATH, qr, { width: 400 });
        logger.info(`QR also saved as an image: ${QR_IMAGE_PATH}`);
      } catch (err) {
        logger.warn({ err }, "Could not save QR as image, use the terminal QR above");
      }
    }

    if (connection === "close") {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      logger.warn({ statusCode, loggedOut }, "Connection closed");
      if (!loggedOut) {
        reconnectAttempts += 1;
        const backoffMs = Math.min(30_000, 2_000 * 2 ** (reconnectAttempts - 1));
        logger.info(`Reconnecting in ${Math.round(backoffMs / 1000)}s (attempt ${reconnectAttempts})...`);
        setTimeout(() => start(), backoffMs);
      } else {
        logger.error(
          "You were logged out (session revoked from your phone). Run `npm run reset-session` then `npm start` to pair again."
        );
      }
    } else if (connection === "open") {
      reconnectAttempts = 0;
      logger.info("Connected to WhatsApp. Bot is live.");
      logger.info(
        `Away mode is currently: ${AWAY_MODE ? "ON (auto-replying)" : "OFF (silent, learning only)"}`
      );
      logger.info(`Learned ${styleLogSize()} of your real messages so far.`);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      try {
        await handleMessage(sock, msg);
      } catch (err) {
        logger.error({ err }, "Error handling message");
      }
    }
  });

  return sock;
}

async function handleMessage(sock, msg) {
  const chatId = msg.key.remoteJid;
  if (!chatId || chatId === "status@broadcast") return;

  const isGroup = chatId.endsWith("@g.us");
  const text = extractText(msg.message);
  if (!text) return; // ignore media-only, reactions, etc. for now

  // ---- Messages YOU sent yourself (from your phone) ----
  if (msg.key.fromMe) {
    // Toggle command, sent to any chat, flips away mode for this run.
    if (text.trim() === TOGGLE_KEYWORD) {
      AWAY_MODE = !AWAY_MODE;
      logger.info(`Away mode toggled -> ${AWAY_MODE ? "ON" : "OFF"}`);
      return;
    }
    // Otherwise, this is a real message in your own voice — learn from it,
    // and treat it as "you handled this chat", so the bot backs off.
    recordOwnMessage(text);
    clearHistory(chatId);
    return;
  }

  // ---- Incoming messages from other people ----
  if (isGroup && !REPLY_IN_GROUPS) return;
  if (!AWAY_MODE) return; // you're online — stay silent, let the person reply themselves

  logger.info({ chatId, isGroup }, "Incoming message");

  // WhatsApp now addresses many chats by an opaque "@lid" id instead of the phone
  // number, so check every identifier the message carries against the ignore list.
  const identifiers = [msg.key.senderPn, msg.key.participantPn, msg.key.participant, chatId]
    .filter(Boolean)
    .map((jid) => jid.split("@")[0].split(":")[0]);
  if (identifiers.some((n) => IGNORE_NUMBERS.has(n))) {
    logger.info({ chatId }, "Sender is on IGNORE_NUMBERS, staying silent");
    return;
  }

  if (!canReply(chatId, MAX_PER_HOUR)) {
    logger.warn({ chatId }, "Hit per-chat hourly reply cap, staying silent");
    return;
  }

  const senderName = msg.pushName || null;

  let replyText;
  try {
    replyText = await generateReply({ chatId, incomingText: text, senderName });
  } catch (err) {
    logger.error({ err }, "Reply generation failed, staying silent for this message");
    return;
  }
  if (!replyText) return;

  // Human-plausible delay + typing indicator before sending, both to feel
  // natural and to reduce the chance of automated-behavior detection.
  const delay = randomDelayMs(MIN_DELAY, MAX_DELAY);
  logger.info({ chatId, delayMs: delay }, "Waiting before sending auto-reply");
  await sock.presenceSubscribe(chatId).catch(() => {});
  await new Promise((r) => setTimeout(r, delay));
  await sock.sendPresenceUpdate("composing", chatId).catch(() => {});
  await new Promise((r) => setTimeout(r, Math.min(3000, delay / 4)));

  await sock.sendMessage(chatId, { text: replyText });
  recordReply(chatId);
  auditAutoReply({ chatId, chatName: senderName, incoming: text, outgoing: replyText });
  logger.info({ chatId }, "Auto-reply sent");
}

process.on("unhandledRejection", (err) => {
  logger.error({ err }, "Unhandled promise rejection");
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception, exiting");
  process.exit(1);
});

start().catch((err) => {
  logger.error({ err }, "Fatal error starting bot");
  process.exit(1);
});
