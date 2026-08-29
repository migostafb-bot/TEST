#!/usr/bin/env node
// Web front end: paste a competitor URL, review the French translation,
// create the listing as a draft in Shopify.
import express from "express";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "../src/config.mjs";
import { fetchProduct } from "../src/scrape.mjs";
import { translateListing } from "../src/translate.mjs";
import { createProduct, findExisting } from "../src/create.mjs";

const app = express();
app.use(express.json({ limit: "1mb" }));

// With no APP_PASSWORD set the site is open to anyone who knows the URL.
// That is a deliberate choice: keep the address private.
const PASSWORD = process.env.APP_PASSWORD || "";
const AUTH_REQUIRED = PASSWORD.length > 0;
if (!AUTH_REQUIRED) {
  console.warn("APP_PASSWORD is not set - running with no login. Anyone with the URL can create products.");
}
// Rotates on restart, which logs everyone out - acceptable for a single-operator tool.
const SESSION_SECRET = process.env.SESSION_SECRET || randomBytes(32).toString("hex");
const COOKIE = "pf_session";

const sign = (value) => `${value}.${createHmac("sha256", SESSION_SECRET).update(value).digest("hex")}`;

function valid(cookieValue) {
  if (!cookieValue) return false;
  const [value, mac] = cookieValue.split(".");
  if (!value || !mac) return false;
  const expected = createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  return Number(value) > Date.now();
}

function readCookie(req) {
  const header = req.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

// Constant-time password check so a wrong guess reveals nothing by timing.
function passwordMatches(candidate) {
  const a = createHmac("sha256", SESSION_SECRET).update(String(candidate ?? "")).digest();
  const b = createHmac("sha256", SESSION_SECRET).update(PASSWORD).digest();
  return timingSafeEqual(a, b);
}

app.get("/api/config", (_req, res) => res.json({ authRequired: AUTH_REQUIRED }));

app.post("/api/login", (req, res) => {
  if (!AUTH_REQUIRED) return res.json({ ok: true });
  if (!passwordMatches(req.body?.password)) {
    return res.status(401).json({ error: "Wrong password." });
  }
  const expires = Date.now() + 30 * 24 * 60 * 60 * 1000;
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${encodeURIComponent(sign(String(expires)))}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${
      30 * 24 * 60 * 60
    }`,
  );
  res.json({ ok: true });
});

app.post("/api/logout", (_req, res) => {
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

function requireAuth(req, res, next) {
  if (AUTH_REQUIRED && !valid(readCookie(req))) return res.status(401).json({ error: "Not signed in." });
  next();
}

const fail = (res, error) => {
  console.error(error);
  res.status(400).json({ error: error.message ?? String(error) });
};

// Step 1: read the competitor page, check for an existing listing, translate.
app.post("/api/preview", requireAuth, async (req, res) => {
  try {
    const { url } = req.body ?? {};
    if (!url) throw new Error("A product URL is required.");

    const source = await fetchProduct(url);
    if (!source.title) throw new Error("No product found on that page - check the URL points at a product.");

    const duplicates = await findExisting({ barcode: source.ean, title: source.title });
    const french = await translateListing(source);

    res.json({ source, duplicates, french });
  } catch (error) {
    fail(res, error);
  }
});

// Step 2: create the (possibly edited) French listing as a draft.
app.post("/api/create", requireAuth, async (req, res) => {
  try {
    const created = await createProduct({ ...req.body, status: "DRAFT" });
    res.json(created);
  } catch (error) {
    fail(res, error);
  }
});

app.use(express.static(join(dirname(fileURLToPath(import.meta.url)), "public")));

const port = Number(process.env.PORT || 8080);
app.listen(port, "0.0.0.0", () => console.log(`Listening on http://0.0.0.0:${port}`));
