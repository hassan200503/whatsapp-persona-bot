// Load .env before anything else in the app — and let it win over any
// same-named variable that happens to already be set in the shell/OS
// environment, rather than being silently shadowed by it.
import dotenv from "dotenv";

dotenv.config({ override: true });
