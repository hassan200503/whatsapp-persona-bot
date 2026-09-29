// Headless sanity check for the companion's brain — no WhatsApp needed.
// Usage: npm run test-companion -- "hey, how's it going?"
import "../src/env.js";
import { handleCompanionMessage } from "../src/companion/companion.js";

const message = process.argv.slice(2).join(" ") || "Hey, this is a test message.";

console.log(`You: ${message}`);
try {
  const reply = await handleCompanionMessage(message);
  console.log(`Companion: ${reply}`);
} catch (err) {
  console.error("Failed:", err.message);
  process.exit(1);
}
