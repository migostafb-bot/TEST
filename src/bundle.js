#!/usr/bin/env node
/**
 * Bundles the client, templates and deploy logic into one standalone file the
 * user can run anywhere with `node deploy-klaviyo.mjs <api-key> "<Store Name>"`.
 * Generated rather than hand-written so it can't drift from src/.
 */
import { readFile, writeFile, mkdir } from 'fs/promises';

const strip = (src) =>
  src
    .replace(/^import[\s\S]*?from\s+'[^']+';\s*$/gm, '')
    .replace(/^export\s+(const|class)\s/gm, '$1 ')
    .replace(/^export\s*\{[^}]*\};?\s*$/gm, '');

const read = async (f) => strip(await readFile(new URL(f, import.meta.url), 'utf8'));

const runner = `
/* --- standalone entry point --- */
const [apiKey, storeName = 'My Store', locale = 'fr'] = process.argv.slice(2);
if (!apiKey || !apiKey.startsWith('pk_')) {
  console.error('Usage: node deploy-klaviyo.mjs <private-api-key> "<Store Name>" [fr|en]');
  process.exit(1);
}

const store = {
  name: storeName,
  locale,
  brand: { logoUrl: '', primary: '#1a1a1a', accent: '#2f6fed', background: '#f4f4f5', text: '#1a1a1a', muted: '#6b7280' },
  incentive: { type: 'free_shipping', code: 'COMEBACK' },
};

const toPlainText = (html) =>
  html.replace(/<style[\\s\\S]*?<\\/style>/gi, '').replace(/<[^>]+>/g, ' ')
      .replace(/&middot;/g, '-').replace(/&nbsp;/g, ' ').replace(/\\s+/g, ' ').trim();

const run = async () => {
  const client = new KlaviyoClient(apiKey);
  console.log('Connecting to Klaviyo...');
  const existing = await client.listTemplates();
  const byName = new Map((existing?.data || []).map((t) => [t.attributes.name, t.id]));

  for (const t of buildTemplates(store)) {
    const payload = { name: t.name, html: t.html, text: toPlainText(t.html) };
    const id = byName.get(t.name);
    if (id) { await client.updateTemplate(id, payload); console.log('  updated  ' + t.name); }
    else { await client.createTemplate(payload); console.log('  created  ' + t.name); }
  }
  console.log('\\nDone. Open Klaviyo -> Content -> Templates to see them.');
};

run().catch((e) => { console.error('\\nFAILED: ' + e.message); process.exit(1); });
`;

const out = [
  '#!/usr/bin/env node',
  '/* Klaviyo abandoned-checkout templates - standalone deployer. Node 18+. */',
  await read('./klaviyo.js'),
  await read('./templates.js'),
  runner,
].join('\n');

await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await writeFile(new URL('../dist/deploy-klaviyo.mjs', import.meta.url), out);
console.log(`dist/deploy-klaviyo.mjs  (${out.length} bytes)`);
