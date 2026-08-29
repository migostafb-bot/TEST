#!/usr/bin/env node
// One-time OAuth install: opens the store's authorize URL, catches the callback
// on localhost, exchanges the code for an offline Admin API access token.
import { createServer } from "node:http";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { writeFileSync, chmodSync } from "node:fs";
import { spawn } from "node:child_process";
import { config, TOKEN_FILE } from "./config.mjs";

const state = randomBytes(16).toString("hex");
const redirect = new URL(config.redirectUri);
const port = Number(redirect.port || 80);

function verifyHmac(params) {
  const received = params.get("hmac");
  if (!received) return false;
  const message = [...params.entries()]
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  const expected = createHmac("sha256", config.clientSecret).update(message).digest();
  const got = Buffer.from(received, "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

async function exchange(code) {
  const response = await fetch(`https://${config.store}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
    }),
  });
  if (!response.ok) {
    throw new Error(`Token exchange failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

const authorizeUrl =
  `https://${config.store}/admin/oauth/authorize` +
  `?client_id=${encodeURIComponent(config.clientId)}` +
  `&scope=${encodeURIComponent(config.scopes.join(","))}` +
  `&redirect_uri=${encodeURIComponent(config.redirectUri)}` +
  `&state=${state}` +
  `&grant_options[]=`; // empty = offline token that does not expire

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname !== redirect.pathname) {
    res.writeHead(404).end("Not found");
    return;
  }
  const params = url.searchParams;
  const finish = (status, message) => {
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<html><body style="font-family:system-ui;padding:2rem"><h1>${message}</h1></body></html>`);
  };
  try {
    if (params.get("state") !== state) throw new Error("State mismatch - possible CSRF, aborting.");
    if (!verifyHmac(params)) throw new Error("HMAC verification failed - request not from Shopify.");
    const shop = params.get("shop");
    if (shop !== config.store) throw new Error(`Unexpected shop in callback: ${shop}`);

    const token = await exchange(params.get("code"));
    writeFileSync(
      TOKEN_FILE,
      JSON.stringify({ shop: config.store, ...token, obtained_at: new Date().toISOString() }, null, 2),
    );
    chmodSync(TOKEN_FILE, 0o600);
    finish(200, "Store linked. You can close this tab.");
    console.log(`\nAccess token saved to ${TOKEN_FILE}`);
    console.log(`Granted scopes: ${token.scope}`);
    server.close(() => process.exit(0));
  } catch (error) {
    finish(400, "Install failed - see terminal.");
    console.error(`\n${error.message}`);
    server.close(() => process.exit(1));
  }
});

server.listen(port, () => {
  console.log(`Listening on ${config.redirectUri}`);
  console.log(`\nOpen this URL while logged in as a staff account for ${config.store}:\n`);
  console.log(authorizeUrl + "\n");
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(opener, [authorizeUrl], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
});
