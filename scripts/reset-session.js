import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const authDir = path.join(__dirname, "..", "auth");

fs.rmSync(authDir, { recursive: true, force: true });
fs.mkdirSync(authDir, { recursive: true });

console.log("Session cleared. Next start will show a fresh QR code.");
