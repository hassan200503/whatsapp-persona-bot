// Tracks how many auto-replies each chat has received recently, so the bot
// never spams one person and stays under a human-plausible message rate
// (both a courtesy to the person on the other end and a way to reduce the
// chance WhatsApp's abuse detection flags the account).

const sentTimestamps = new Map(); // chatId -> array of epoch-ms timestamps

export function canReply(chatId, maxPerHour) {
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const history = (sentTimestamps.get(chatId) || []).filter((t) => t > hourAgo);
  sentTimestamps.set(chatId, history);
  return history.length < maxPerHour;
}

export function recordReply(chatId) {
  const history = sentTimestamps.get(chatId) || [];
  history.push(Date.now());
  sentTimestamps.set(chatId, history);
}

export function randomDelayMs(minSeconds, maxSeconds) {
  const min = Math.max(1, minSeconds) * 1000;
  const max = Math.max(min, maxSeconds * 1000);
  return Math.floor(min + Math.random() * (max - min));
}
