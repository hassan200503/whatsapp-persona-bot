// Voice in/out for the companion, via Groq's free-tier hosted Whisper
// (transcription) and Orpheus (speech). Both run in the cloud rather than
// on this machine's weak CPU — a deliberate tradeoff confirmed with the
// owner, since whisper.cpp turned out to have no prebuilt Windows binary.

import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import ffmpegPath from "ffmpeg-static";

const GROQ_STT_MODEL = process.env.GROQ_STT_MODEL || "whisper-large-v3-turbo";
const GROQ_TTS_MODEL = process.env.GROQ_TTS_MODEL || "canopylabs/orpheus-v1-english";
const GROQ_TTS_VOICE = process.env.GROQ_TTS_VOICE || "tara";

function requireGroqKey() {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not set — required for voice transcription/replies.");
  }
  return process.env.GROQ_API_KEY;
}

// buffer: raw audio bytes as WhatsApp sent them (ogg/opus voice note).
export async function transcribeAudio(buffer, filename = "voice.ogg") {
  const apiKey = requireGroqKey();
  const form = new FormData();
  form.append("file", new Blob([buffer]), filename);
  form.append("model", GROQ_STT_MODEL);

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Groq transcription failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return (data.text || "").trim();
}

// Returns an ogg/opus Buffer ready to send as a WhatsApp voice note (ptt).
export async function synthesizeSpeech(text) {
  const apiKey = requireGroqKey();
  const res = await fetch("https://api.groq.com/openai/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GROQ_TTS_MODEL,
      input: text,
      voice: GROQ_TTS_VOICE,
      response_format: "wav",
    }),
  });
  if (!res.ok) {
    throw new Error(`Groq TTS failed: ${res.status} ${await res.text()}`);
  }
  const wavBuffer = Buffer.from(await res.arrayBuffer());
  return convertWavToOggOpus(wavBuffer);
}

function convertWavToOggOpus(wavBuffer) {
  return new Promise((resolve, reject) => {
    const tmpDir = os.tmpdir();
    const id = crypto.randomBytes(6).toString("hex");
    const inPath = path.join(tmpDir, `companion-tts-${id}.wav`);
    const outPath = path.join(tmpDir, `companion-tts-${id}.ogg`);

    fs.writeFileSync(inPath, wavBuffer);

    const ffmpeg = spawn(ffmpegPath, [
      "-y",
      "-i", inPath,
      "-c:a", "libopus",
      "-b:a", "32k",
      "-ar", "48000",
      "-ac", "1",
      outPath,
    ]);

    let stderr = "";
    ffmpeg.stderr.on("data", (chunk) => { stderr += chunk; });

    ffmpeg.on("error", (err) => {
      cleanup();
      reject(err);
    });

    ffmpeg.on("close", (code) => {
      if (code !== 0) {
        cleanup();
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
        return;
      }
      try {
        const oggBuffer = fs.readFileSync(outPath);
        cleanup();
        resolve(oggBuffer);
      } catch (err) {
        cleanup();
        reject(err);
      }
    });

    function cleanup() {
      fs.rm(inPath, () => {});
      fs.rm(outPath, () => {});
    }
  });
}
