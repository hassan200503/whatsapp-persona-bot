// The first (and safest) tool the companion gets: saving a reminder is a
// local DB write with no outward effect, so unlike email/device-control
// tools it doesn't need a propose-then-confirm gate.

import { addReminder } from "../db.js";

// Standard (lowercase) JSON Schema — llm.js adapts this to whichever
// provider's tool format is needed (Gemini uses uppercase type names).
export const reminderToolDeclarations = [
  {
    name: "set_reminder",
    description:
      "Save a reminder that will be delivered to the owner as a WhatsApp message at the given time.",
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The reminder message itself, written as it should be delivered.",
        },
        due_at_iso: {
          type: "string",
          description:
            "When to deliver it, as a full ISO 8601 datetime (e.g. 2026-10-01T09:00:00) in the owner's local time. Convert any relative time the owner gave (e.g. 'in 2 hours', 'tomorrow morning') into this format using the current date/time given to you.",
        },
      },
      required: ["text", "due_at_iso"],
    },
  },
];

export function executeReminderTool(name, args) {
  if (name === "set_reminder") {
    const id = addReminder(args.text, args.due_at_iso);
    return { saved: true, reminderId: id };
  }
  return { error: `Unknown tool: ${name}` };
}
