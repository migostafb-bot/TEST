import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const TOKEN_FILE = resolve(ROOT, ".shopify-token.json");

// Minimal .env loader so the server works without extra dependencies.
function loadDotEnv() {
  const file = resolve(ROOT, ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}
loadDotEnv();

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
  return value;
}

export const config = {
  get store() {
    return required("SHOPIFY_STORE").replace(/^https?:\/\//, "").replace(/\/$/, "");
  },
  get clientId() {
    return required("SHOPIFY_CLIENT_ID");
  },
  get clientSecret() {
    return required("SHOPIFY_CLIENT_SECRET");
  },
  get scopes() {
    return (process.env.SHOPIFY_SCOPES || "read_products").split(",").map((s) => s.trim()).filter(Boolean);
  },
  get redirectUri() {
    return process.env.SHOPIFY_REDIRECT_URI || "http://localhost:3456/callback";
  },
  get apiVersion() {
    return process.env.SHOPIFY_API_VERSION || "2025-07";
  },
};

export function readToken() {
  if (process.env.SHOPIFY_ACCESS_TOKEN) return process.env.SHOPIFY_ACCESS_TOKEN;
  if (existsSync(TOKEN_FILE)) {
    const saved = JSON.parse(readFileSync(TOKEN_FILE, "utf8"));
    if (saved.access_token) return saved.access_token;
  }
  throw new Error("No access token. Run `npm run auth` to install the app on the store.");
}
