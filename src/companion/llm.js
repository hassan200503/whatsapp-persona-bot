// The companion's brain: Gemini free tier as the primary model, Groq free
// tier as a fallback so the companion never just goes silent if Gemini's
// daily free quota is hit. Both are genuinely free (no card) as of the
// research behind this build — see the plan doc for sources.

import { GoogleGenAI } from "@google/genai";
import Groq from "groq-sdk";
import { logger } from "../logger.js";

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
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
// toolExecutor(name, args) => result object; only used when tools is non-empty.
// Tool calling only runs through Gemini — Groq is a plain-text fallback.
export async function generateCompanionReply({ systemPrompt, history, tools = [], toolExecutor }) {
  const gemini = getGenAI();
  if (gemini) {
    try {
      return await callGemini(gemini, systemPrompt, history, tools, toolExecutor);
    } catch (err) {
      logger.warn({ err: err?.message }, "Gemini call failed, trying Groq fallback");
    }
  }

  const groqClient = getGroq();
  if (groqClient) {
    try {
      return await callGroq(groqClient, systemPrompt, history, tools, toolExecutor);
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

const MAX_TOOL_ROUNDS = 5;

// Our tool declarations are standard (lowercase-type) JSON Schema. Gemini's
// function-calling wants the same shape but with UPPERCASE type names.
function toGeminiSchema(node) {
  if (!node || typeof node !== "object") return node;
  const out = { ...node };
  if (typeof out.type === "string") out.type = out.type.toUpperCase();
  if (out.properties) {
    out.properties = Object.fromEntries(
      Object.entries(out.properties).map(([k, v]) => [k, toGeminiSchema(v)])
    );
  }
  if (out.items) out.items = toGeminiSchema(out.items);
  return out;
}
function toGeminiFunctionDeclarations(tools) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: toGeminiSchema(t.parameters),
  }));
}

async function callGemini(gemini, systemPrompt, history, tools, toolExecutor) {
  const contents = history.map((turn) => ({
    role: turn.role === "companion" ? "model" : "user",
    parts: [{ text: turn.content }],
  }));

  const config = { systemInstruction: systemPrompt };
  if (tools.length > 0) {
    config.tools = [{ functionDeclarations: toGeminiFunctionDeclarations(tools) }];
  }

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await gemini.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config,
    });

    const calls = response.functionCalls;
    if (!calls || calls.length === 0) {
      return { text: response.text?.trim() || "" };
    }

    contents.push({
      role: "model",
      parts: calls.map((c) => ({ functionCall: { name: c.name, args: c.args || {} } })),
    });

    const responseParts = [];
    for (const call of calls) {
      const result = toolExecutor
        ? await toolExecutor(call.name, call.args || {})
        : { error: "No tool executor configured" };
      responseParts.push({ functionResponse: { name: call.name, response: result } });
    }
    contents.push({ role: "user", parts: responseParts });
  }

  return { text: "" };
}

function toGroqTools(tools) {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

async function callGroq(groqClient, systemPrompt, history, tools, toolExecutor) {
  const messages = [
    { role: "system", content: systemPrompt },
    ...history.map((turn) => ({
      role: turn.role === "companion" ? "assistant" : "user",
      content: turn.content,
    })),
  ];

  const requestOpts = { model: GROQ_MODEL, messages, max_tokens: 500 };
  if (tools.length > 0) requestOpts.tools = toGroqTools(tools);

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const completion = await groqClient.chat.completions.create(requestOpts);
    const message = completion.choices[0]?.message;
    const toolCalls = message?.tool_calls;

    if (!toolCalls || toolCalls.length === 0) {
      return { text: message?.content?.trim() || "" };
    }

    messages.push({ role: "assistant", content: message.content || null, tool_calls: toolCalls });

    for (const call of toolCalls) {
      let args = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        // leave args empty if the model sent malformed JSON
      }
      const result = toolExecutor
        ? await toolExecutor(call.function.name, args)
        : { error: "No tool executor configured" };
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  return { text: "" };
}
