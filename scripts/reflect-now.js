// Manually trigger the nightly reflection job right now instead of waiting
// for its scheduled time — useful after a real conversation, or to check
// it's working.
import "../src/env.js";
import { runNightlyReflection } from "../src/companion/scheduler.js";
import { getRecentJournal, getRecentFacts } from "../src/companion/db.js";

await runNightlyReflection();

console.log("Journal:", JSON.stringify(getRecentJournal(3), null, 2));
console.log("Facts:", JSON.stringify(getRecentFacts(10), null, 2));
