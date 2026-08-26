#!/usr/bin/env node
/**
 * Deploys templates to Klaviyo. Matches on template name, so re-running
 * updates in place instead of piling up duplicates.
 *
 * Usage: node src/deploy.js [storeKey] [--dry-run]
 */
import { readFile } from 'fs/promises';
import { KlaviyoClient } from './klaviyo.js';
import { buildTemplates } from './templates.js';

/** Klaviyo requires a plain-text alternative; without one, spam filters penalise the send. */
const toPlainText = (html) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&middot;/g, '-')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const main = async () => {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const storeKey = args.find((a) => !a.startsWith('--')) || 'store1';

  const stores = JSON.parse(await readFile(new URL('../config/stores.json', import.meta.url)));
  const store = stores[storeKey];
  if (!store) throw new Error(`Unknown store "${storeKey}". Known: ${Object.keys(stores).join(', ')}`);

  const templates = buildTemplates(store);

  if (dryRun) {
    console.log(`[dry-run] ${store.name}: would deploy ${templates.length} templates`);
    templates.forEach((t) => console.log(`  - ${t.name}`));
    return;
  }

  const apiKey = process.env[store.apiKeyEnv];
  if (!apiKey) throw new Error(`${store.apiKeyEnv} is not set in the environment`);

  const client = new KlaviyoClient(apiKey);
  const existing = await client.listTemplates();
  const byName = new Map((existing?.data || []).map((t) => [t.attributes.name, t.id]));

  for (const t of templates) {
    const payload = { name: t.name, html: t.html, text: toPlainText(t.html) };
    const id = byName.get(t.name);
    if (id) {
      await client.updateTemplate(id, payload);
      console.log(`updated  ${t.name}`);
    } else {
      const created = await client.createTemplate(payload);
      console.log(`created  ${t.name} (${created.data.id})`);
    }
  }
};

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
