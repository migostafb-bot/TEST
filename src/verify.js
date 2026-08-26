#!/usr/bin/env node
/**
 * Pre-flight check against a live Klaviyo account.
 *
 * The templates render Liquid against Shopify's "Started Checkout" event, and a
 * wrong variable name renders as an empty block rather than an error -- so the
 * only way to catch it is to read a real event payload before deploying.
 *
 * Usage: node src/verify.js [storeKey]
 */
import { readFile } from 'fs/promises';
import { KlaviyoClient } from './klaviyo.js';

const METRIC_NAME = 'Started Checkout';

/**
 * Klaviyo's Liquid exposes the event's `$extra` property as `event.extra`, so
 * `event.extra.checkout_url` is `event_properties.$extra.checkout_url` in the
 * API payload. Each entry is [liquid path, path within event_properties].
 */
const REQUIRED = [
  ['event.extra.checkout_url', ['$extra', 'checkout_url']],
  ['event.extra.line_items', ['$extra', 'line_items']],
];
const REQUIRED_ITEM_FIELDS = ['title', 'line_price', 'image_url'];

const dig = (obj, path) => path.reduce((v, k) => (v == null ? undefined : v[k]), obj);

const ok = (msg) => console.log(`  ok    ${msg}`);
const bad = (msg) => {
  console.log(`  FAIL  ${msg}`);
  process.exitCode = 1;
};

/** Walks `links.next` so the metric is found even in accounts with many metrics. */
const findMetric = async (client, name) => {
  let path = '/metrics/';
  for (let page = 0; page < 10 && path; page++) {
    const body = await client.request('GET', path);
    const hit = (body?.data || []).find((m) => m.attributes.name === name);
    if (hit) return hit;
    const next = body?.links?.next;
    path = next ? next.replace(/^https:\/\/a\.klaviyo\.com\/api/, '') : null;
  }
  return null;
};

const main = async () => {
  const storeKey = process.argv[2] || 'store1';
  const stores = JSON.parse(await readFile(new URL('../config/stores.json', import.meta.url)));
  const store = stores[storeKey];
  if (!store) throw new Error(`Unknown store "${storeKey}". Known: ${Object.keys(stores).join(', ')}`);

  const apiKey = process.env[store.apiKeyEnv];
  if (!apiKey) throw new Error(`${store.apiKeyEnv} is not set in the environment`);
  const client = new KlaviyoClient(apiKey);

  console.log(`${store.name} (${storeKey})`);

  console.log('\nAPI key');
  const account = await client.whoami();
  const org = account?.data?.[0]?.attributes;
  ok(`connected to "${org?.contact_information?.organization_name || 'unnamed account'}"`);

  try {
    await client.request('GET', '/templates/?page%5Bsize%5D=1');
    ok('key can read templates (deploy needs Templates: full access)');
  } catch (err) {
    bad(`key cannot read templates -- ${err.message}`);
  }

  console.log(`\n"${METRIC_NAME}" event`);
  const metric = await findMetric(client, METRIC_NAME);
  if (!metric) {
    bad(`no "${METRIC_NAME}" metric in this account -- is the Shopify integration connected?`);
    return;
  }
  ok(`metric found (${metric.id}, integration: ${metric.attributes.integration?.name || 'unknown'})`);

  const filter = encodeURIComponent(`equals(metric_id,"${metric.id}")`);
  const events = await client.request('GET', `/events/?filter=${filter}&sort=-datetime&page%5Bsize%5D=1`);
  const event = events?.data?.[0];
  if (!event) {
    bad('no events recorded yet -- start a checkout on the store, then re-run');
    return;
  }
  const props = event.attributes.event_properties || {};
  ok(`latest event ${event.attributes.datetime}`);

  console.log('\nLiquid variables used by the templates');
  for (const [liquid, path] of REQUIRED) {
    const value = dig(props, path);
    if (value == null) bad(`${liquid} -- missing from the payload`);
    else ok(`${liquid}`);
  }

  const items = dig(props, ['$extra', 'line_items']);
  if (Array.isArray(items) && items.length) {
    for (const field of REQUIRED_ITEM_FIELDS) {
      if (items[0][field] == null) bad(`item.${field} -- missing from the first line item`);
      else ok(`item.${field}`);
    }
  } else if (Array.isArray(items)) {
    console.log('  skip  line items empty on this event -- item fields unchecked');
  }

  if (process.exitCode) {
    console.log('\nAvailable keys under event.extra:');
    console.log(`  ${Object.keys(dig(props, ['$extra']) || {}).join(', ') || '(none)'}`);
    console.log('Adjust src/templates.js to match before deploying.');
  } else {
    console.log('\nAll checks passed -- safe to deploy.');
  }
};

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
