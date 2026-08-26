#!/usr/bin/env node
/** Writes the templates to preview/ so they can be opened in a browser. */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { buildTemplates } from './templates.js';

const stores = JSON.parse(await readFile(new URL('../config/stores.json', import.meta.url)));
const storeKey = process.argv[2] || 'store1';
await mkdir(new URL('../preview/', import.meta.url), { recursive: true });

for (const [i, t] of buildTemplates(stores[storeKey]).entries()) {
  const file = new URL(`../preview/${storeKey}-${i + 1}.html`, import.meta.url);
  await writeFile(file, t.html);
  console.log(`preview/${storeKey}-${i + 1}.html  ${t.subject}`);
}
