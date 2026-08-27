#!/usr/bin/env node
/**
 * Creates the abandoned-checkout flow in a store, using another store's flow
 * as the structural source (trigger, profile filters, delays, re-entry).
 *
 * It is deliberately not a verbatim clone. The source flow's emails carry
 * whatever templates and subject lines that store happens to use; this wires
 * each target store to *its own* deployed templates and the subject lines the
 * templates were built with, so the flow sends the store's real copy rather
 * than a copy of another store's.
 *
 * Metrics and templates are resolved by name in each account, so no ids are
 * hardcoded here.
 *
 * Usage:
 *   node src/deploy-flow.js --from store1 --to store2,store3,store4 [--confirm]
 *
 * Without --confirm it prints what it would send and creates nothing.
 *
 * --no-delay  drops the wait before email 1 entirely, so it sends on trigger.
 *   Klaviyo had an incident where profiles stopped progressing past a
 *   time-delay action; flows without one were unaffected, which makes this the
 *   way to test end-to-end while that is happening.
 * --first-delay <minutes>  overrides the wait before email 1. Meant for
 *   testing: 5 minutes instead of an hour makes a real abandoned checkout
 *   testable in one sitting. Use --name to keep such a flow clearly separate
 *   from the production one.
 * --name <text>  overrides the created flow's name.
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { KlaviyoClient } from './klaviyo.js';
import { buildDefinition, findSourceLeaks } from './flow-definition.js';
import { buildTemplates } from './templates.js';

const SNAPSHOT_DIR = new URL('../snapshots/', import.meta.url);

const TRIGGER_METRIC = 'Checkout Started';

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

const indexByName = (payload, pick = (x) => x.attributes.name) =>
  new Map((payload?.data || []).map((x) => [pick(x), x.id]));

/**
 * Templates are named "[Store Name] Abandoned Checkout N - ...", so the part
 * after the store prefix is what matches across accounts.
 */
const suffixOf = (name) => name.replace(/^\[[^\]]*\]\s*/, '');

const resolveStore = async (client, store) => {
  const [templates, metrics] = await Promise.all([client.listTemplates(), client.listMetrics()]);
  return {
    templatesBySuffix: indexByName(templates, (t) => suffixOf(t.attributes.name)),
    metricsByName: indexByName(metrics),
  };
};

const main = async () => {
  const from = arg('from', 'store1');
  const to = (arg('to', '') || '').split(',').filter(Boolean);
  const confirm = flag('confirm');

  if (!to.length) throw new Error('Pass --to store2,store3,store4');

  const stores = JSON.parse(await readFile(new URL('../config/stores.json', import.meta.url)));
  const sourceStore = stores[from];
  if (!sourceStore) throw new Error(`Unknown source store "${from}"`);

  const sourceClient = new KlaviyoClient(keyFor(sourceStore));
  const sourceResolved = await resolveStore(sourceClient, sourceStore);

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

  const sourceFlow = await sourceClient.getFlowDefinition(flowId);
  const source = sourceFlow?.data?.attributes?.definition;
  if (!source) throw new Error(`Flow ${flowId} returned no definition`);

  await mkdir(SNAPSHOT_DIR, { recursive: true });
  await writeFile(
    new URL(`flow-${from}-${flowId}.json`, SNAPSHOT_DIR),
    JSON.stringify(sourceFlow.data, null, 2),
  );

  const emailActions = source.actions.filter((a) => a.type === 'send-email');
  console.log(
    `source: ${sourceStore.name} flow ${flowId} "${sourceFlow.data.attributes?.name}" ` +
      `(${source.actions.length} actions, ${emailActions.length} emails)`,
  );

  // Every id that belongs to the source account, for the leak check.
  const sourceIds = new Set([
    ...source.triggers.map((t) => t.id),
    ...source.actions.map((a) => a.id),
    ...emailActions.flatMap((a) => [a.data.message.template_id, a.data.message.id]),
  ]);

  const sourceTriggerMetric = source.triggers[0]?.id;

  for (const targetKey of to) {
    const targetStore = stores[targetKey];
    if (!targetStore) throw new Error(`Unknown target store "${targetKey}"`);

    const sending = targetStore.sending || {};
    if (!sending.fromEmail || !sending.fromLabel) {
      console.error(
        `\n${targetStore.name}: SKIPPED -- config/stores.json has no sending.fromEmail / ` +
          `sending.fromLabel. Sending from another store's domain would be wrong, so ` +
          `this is not guessed.`,
      );
      continue;
    }

    const targetClient = new KlaviyoClient(keyFor(targetStore));
    const target = await resolveStore(targetClient, targetStore);

    // Map every metric the source definition mentions, by name.
    const metricMap = new Map();
    const sourceMetricNames = new Map(
      [...sourceResolved.metricsByName].map(([name, id]) => [id, name]),
    );
    const mapMetric = (sourceId) => {
      const name = sourceMetricNames.get(sourceId);
      if (!name) throw new Error(`Source metric ${sourceId} not found in ${sourceStore.name}`);
      const targetId = target.metricsByName.get(name);
      if (!targetId) throw new Error(`${targetStore.name} has no metric named "${name}"`);
      metricMap.set(sourceId, targetId);
      return targetId;
    };

    mapMetric(sourceTriggerMetric);
    JSON.stringify(source.profile_filter, (key, value) => {
      if (key === 'metric_id' && typeof value === 'string') mapMetric(value);
      return value;
    });

    // The subject line each template was authored with lives alongside the
    // template in templates.js -- use that rather than the source flow's.
    const built = buildTemplates(targetStore);
    const messages = built.map((t) => {
      const templateId = target.templatesBySuffix.get(suffixOf(t.name));
      if (!templateId) {
        throw new Error(
          `${targetStore.name} has no template "${t.name}" -- run \`npm run deploy ${targetKey}\` first`,
        );
      }
      return {
        template_id: templateId,
        subject_line: t.subject,
        from_email: sending.fromEmail,
        from_label: sending.fromLabel,
        name: t.name,
      };
    });

    if (messages.length !== emailActions.length) {
      throw new Error(
        `Source flow has ${emailActions.length} emails but ${messages.length} templates are built ` +
          `for ${targetStore.name}`,
      );
    }

    const definition = buildDefinition({
      source,
      metricMap,
      messageFor: (i) => messages[i],
    });

    if (flag('no-delay')) {
      const first = definition.actions[0];
      if (first?.type !== 'time-delay') throw new Error('First action is not a delay; nothing to drop');
      definition.actions = definition.actions.slice(1);
      definition.entry_action_id = first.links.next;
    }

    const firstDelay = arg('first-delay');
    if (firstDelay) {
      const minutes = Number(firstDelay);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        throw new Error(`--first-delay must be a positive number of minutes, got "${firstDelay}"`);
      }
      const delay = definition.actions.find((a) => a.type === 'time-delay');
      if (!delay) throw new Error('Source flow has no time-delay to override');
      delay.data = { ...delay.data, unit: 'minutes', value: minutes, secondary_value: 0 };
    }

    // An id that is a legitimate mapping *target* is not a leak -- when source
    // and target are the same account, a metric correctly maps to itself.
    const allowedTargets = new Set([...metricMap.values(), ...messages.map((m) => m.template_id)]);
    const leaks = findSourceLeaks(definition, sourceIds).filter(
      (l) => !allowedTargets.has(l.value),
    );
    if (leaks.length) {
      console.error(`\n${targetStore.name}: ABORT -- source ids still present:`);
      leaks.forEach((l) => console.error(`  ${l.path} = ${l.value}`));
      continue;
    }

    const name = arg('name') || `Abandoned Checkout - ${targetStore.name}`;

    if (!confirm) {
      console.log(`\n[dry-run] ${targetStore.name}: would create "${name}"`);
      console.log(`  trigger metric  ${sourceTriggerMetric} -> ${metricMap.get(sourceTriggerMetric)} (${TRIGGER_METRIC})`);
      console.log(`  from            ${sending.fromLabel} <${sending.fromEmail}>`);
      if (flag('no-delay')) console.log('  first delay     REMOVED -- email 1 sends on trigger');
      if (arg('first-delay')) console.log(`  first delay     OVERRIDDEN to ${arg('first-delay')} minutes`);
      definition.actions.forEach((a) => {
        if (a.type === 'send-email') {
          console.log(
            `  email           ${a.data.message.template_id}  "${a.data.message.subject_line}"`,
          );
        } else {
          console.log(`  delay           ${a.data.value} ${a.data.unit}`);
        }
      });
      continue;
    }

    const created = await targetClient.createFlow({ name, definition });
    console.log(
      `\n${targetStore.name}: created flow ${created?.data?.id} "${name}" ` +
        `status=${created?.data?.attributes?.status}`,
    );
  }

  if (!confirm) console.log('\nNothing created. Re-run with --confirm.');
};

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
