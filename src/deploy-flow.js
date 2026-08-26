#!/usr/bin/env node
/**
 * Clones the abandoned-checkout flow from a source store into other stores.
 *
 * The create endpoint takes a whole flow definition, and the practical way to
 * get a valid one is to read it back off a flow that already exists. So this
 * reads the source store's flow, remaps everything that pointed at the source
 * account, and posts the result to each target.
 *
 * Flows arrive in Draft. Nothing here sets one live.
 *
 * Usage:
 *   node src/deploy-flow.js --from store1 --to store2,store3,store4 [--flow-id ID] [--dry-run]
 *
 * Without --confirm it stops after printing what it would send.
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { KlaviyoClient } from './klaviyo.js';
import { retargetDefinition } from './flow-definition.js';

const SNAPSHOT_DIR = new URL('../snapshots/', import.meta.url);

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const flag = (name) => process.argv.includes(`--${name}`);

const keyFor = (store) => {
  const apiKey = process.env[store.apiKeyEnv];
  if (!apiKey) throw new Error(`${store.apiKeyEnv} is not set in the environment`);
  return apiKey;
};

/**
 * Templates are per-account and named after the store, so a source template
 * called "Store One Abandoned Checkout 2" matches "Store Two Abandoned
 * Checkout 2" in the target. Matching on the trailing part keeps that stable
 * even if the store names change.
 */
const templateSuffix = (name, storeName) =>
  name.startsWith(storeName) ? name.slice(storeName.length).trim() : name;

const buildTemplateMap = async (sourceClient, targetClient, sourceStore, targetStore) => {
  const [sourceTemplates, targetTemplates] = await Promise.all([
    sourceClient.listTemplates(),
    targetClient.listTemplates(),
  ]);

  const targetBySuffix = new Map(
    (targetTemplates?.data || []).map((t) => [
      templateSuffix(t.attributes.name, targetStore.name),
      t.id,
    ]),
  );

  const map = new Map();
  const missing = [];
  for (const t of sourceTemplates?.data || []) {
    const suffix = templateSuffix(t.attributes.name, sourceStore.name);
    const targetId = targetBySuffix.get(suffix);
    if (targetId) map.set(t.id, targetId);
    else missing.push(t.attributes.name);
  }
  return { map, missing };
};

const main = async () => {
  const from = arg('from', 'store1');
  const to = (arg('to', '') || '').split(',').filter(Boolean);
  const confirm = flag('confirm');
  const dryRun = flag('dry-run') || !confirm;

  if (!to.length) throw new Error('Pass --to store2,store3,store4');

  const stores = JSON.parse(await readFile(new URL('../config/stores.json', import.meta.url)));
  const sourceStore = stores[from];
  if (!sourceStore) throw new Error(`Unknown source store "${from}"`);

  const sourceClient = new KlaviyoClient(keyFor(sourceStore));

  // Find the flow to clone: an explicit id, or the one abandoned-checkout flow
  // in the source account.
  let flowId = arg('flow-id');
  if (!flowId) {
    const flows = await sourceClient.listFlows();
    const candidates = (flows?.data || []).filter((f) =>
      /abandon|checkout/i.test(f.attributes?.name || ''),
    );
    if (candidates.length !== 1) {
      const names = (flows?.data || []).map((f) => `  ${f.id}  ${f.attributes?.name}`).join('\n');
      throw new Error(
        `Could not pick a source flow automatically (${candidates.length} matched). ` +
          `Pass --flow-id. Flows in ${sourceStore.name}:\n${names}`,
      );
    }
    flowId = candidates[0].id;
  }

  const source = await sourceClient.getFlowDefinition(flowId);
  const definition = source?.data?.attributes?.definition;
  if (!definition) throw new Error(`Flow ${flowId} returned no definition`);

  // Keep the source definition on disk: it is the only reference for what a
  // valid payload looks like, and re-fetching needs the source key again.
  await mkdir(SNAPSHOT_DIR, { recursive: true });
  await writeFile(
    new URL(`flow-${from}-${flowId}.json`, SNAPSHOT_DIR),
    JSON.stringify(source.data, null, 2),
  );
  console.log(`source: ${sourceStore.name} flow ${flowId} "${source.data.attributes?.name}"`);
  console.log(`        snapshot written to snapshots/flow-${from}-${flowId}.json`);

  for (const targetKey of to) {
    const targetStore = stores[targetKey];
    if (!targetStore) throw new Error(`Unknown target store "${targetKey}"`);

    const targetClient = new KlaviyoClient(keyFor(targetStore));
    const { map, missing } = await buildTemplateMap(
      sourceClient,
      targetClient,
      sourceStore,
      targetStore,
    );
    if (missing.length) {
      console.warn(
        `\n${targetStore.name}: no matching template for ${missing.join(', ')} ` +
          `-- run \`npm run deploy ${targetKey}\` first`,
      );
    }

    const { definition: retargeted, unresolved } = retargetDefinition(definition, map);

    const name = (source.data.attributes?.name || 'Abandoned Checkout').replace(
      sourceStore.name,
      targetStore.name,
    );

    if (unresolved.length) {
      // Posting these would wire the target store's flow to the source
      // store's resources, so stop rather than create a flow that looks fine
      // in the UI and sends the wrong emails.
      console.error(`\n${targetStore.name}: ABORT -- unmapped references:`);
      unresolved.forEach((u) => console.error(`  ${u.field} = ${u.value}`));
      continue;
    }

    if (dryRun) {
      console.log(`\n[dry-run] ${targetStore.name}: would create flow "${name}"`);
      console.log(`          ${map.size} template references remapped`);
      console.log(JSON.stringify({ name, definition: retargeted }, null, 2).slice(0, 2000));
      continue;
    }

    const created = await targetClient.createFlow({ name, definition: retargeted });
    console.log(`\n${targetStore.name}: created flow ${created?.data?.id} "${name}" (Draft)`);
  }

  if (dryRun) console.log('\nNothing was created. Re-run with --confirm to create the flows.');
};

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
