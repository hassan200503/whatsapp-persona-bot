// The companion's brain: Gemini free tier as the primary model, Groq free
// tier as a fallback so the companion never just goes silent if Gemini's
// daily free quota is hit. Both are genuinely free (no card) as of the
// research behind this build — see the plan doc for sources.

import { GoogleGenAI } from "@google/genai";
import Groq from "groq-sdk";
import { logger } from "../logger.js";

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

let genAI = null;
function getGenAI() {
  if (!genAI) {
    if (!process.env.GEMINI_API_KEY) return null;
    genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return genAI;
}

let groq = null;
function getGroq() {
  if (!groq) {
    if (!process.env.GROQ_API_KEY) return null;
    groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groq;
}

// history: [{ role: "user"|"companion", content: string }]
// Returns { text, functionCalls } (functionCalls is undefined until tools are wired in).
export async function generateCompanionReply({ systemPrompt, history, tools = [] }) {
  const gemini = getGenAI();
  if (gemini) {
    try {
      return await callGemini(gemini, systemPrompt, history, tools);
    } catch (err) {
      logger.warn({ err: err?.message }, "Gemini call failed, trying Groq fallback");
    }
  }

  const groqClient = getGroq();
  if (groqClient) {
    try {
      return await callGroq(groqClient, systemPrompt, history);
    } catch (err) {
      logger.error({ err: err?.message }, "Groq fallback also failed");
    }
  }

  if (!gemini && !groqClient) {
    throw new Error(
      "Neither GEMINI_API_KEY nor GROQ_API_KEY is set. Add at least one to .env."
    );
  }
  throw new Error("Both Gemini and Groq failed to generate a reply.");
}

async function callGemini(gemini, systemPrompt, history, tools) {
  const contents = history.map((turn) => ({
    role: turn.role === "companion" ? "model" : "user",
    parts: [{ text: turn.content }],
  }));

  const config = { systemInstruction: systemPrompt };
  if (tools.length > 0) {
    config.tools = [{ functionDeclarations: tools }];
  }

  const response = await gemini.models.generateContent({
    model: GEMINI_MODEL,
    contents,
    config,
  });

  return { text: response.text?.trim() || "", functionCalls: response.functionCalls };
}

async function callGroq(groqClient, systemPrompt, history) {
  const messages = [
    { role: "system", content: systemPrompt },
    ...history.map((turn) => ({
      role: turn.role === "companion" ? "assistant" : "user",
      content: turn.content,
    })),
  ];

  const completion = await groqClient.chat.completions.create({
    model: GROQ_MODEL,
    messages,
    max_tokens: 500,
  });

  return { text: completion.choices[0]?.message?.content?.trim() || "", functionCalls: undefined };
}
