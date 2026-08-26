/**
 * Builds a flow definition for one store from a definition read off another.
 *
 * The shape is the one returned by
 * GET /api/flows/:id?additional-fields[flow]=definition. Three different kinds
 * of id live in it and each needs different handling -- this is the whole
 * reason this module exists:
 *
 *   1. Action ids (`actions[].id`, `entry_action_id`, `links.next`) identify
 *      nodes *within* the flow. On create these become `temporary_id`, and
 *      every reference to them has to move in step.
 *   2. `triggers[].id` and `profile_filter` `metric_id` are *metric* ids. They
 *      look like node ids but point at account-level objects, so they must be
 *      swapped for the target account's equivalent metric -- never turned into
 *      a temporary_id.
 *   3. `data.message.template_id` points at a template, and `data.message.id`
 *      at an existing message. The template is remapped; the message id is
 *      dropped so the target account mints a fresh one.
 *
 * Getting (2) wrong yields a flow that looks right in the UI but triggers off
 * another store's metric, so the mapping is required rather than optional.
 */

/** @returns the source action list re-keyed onto temporary ids, chain intact. */
const retargetActions = (sourceActions, messageFor) => {
  const tempIds = new Map(sourceActions.map((a, i) => [a.id, `action_${i + 1}`]));

  let emailIndex = 0;
  const actions = sourceActions.map((action) => {
    const next = action.links?.next;
    const rebuilt = {
      temporary_id: tempIds.get(action.id),
      type: action.type,
      links: { next: next ? tempIds.get(next) ?? null : null },
    };

    if (action.type === 'send-email') {
      const overrides = messageFor(emailIndex++);
      const { id, ...message } = action.data.message; // drop the source message id
      rebuilt.data = {
        ...action.data,
        message: { ...message, ...overrides },
      };
    } else {
      rebuilt.data = action.data;
    }
    return rebuilt;
  });

  return { actions, tempIds };
};

/** Rewrites every metric_id in the profile filter to the target account's metric. */
const retargetProfileFilter = (profileFilter, metricMap) => {
  if (!profileFilter) return profileFilter;

  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (node === null || typeof node !== 'object') return node;

    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === 'metric_id' && typeof value === 'string') {
        const mapped = metricMap.get(value);
        if (!mapped) throw new Error(`No target metric mapped for source metric ${value}`);
        out[key] = mapped;
        continue;
      }
      out[key] = walk(value);
    }
    return out;
  };

  return walk(profileFilter);
};

/**
 * @param source      the source store's `definition` object
 * @param metricMap   Map of source metric id -> target metric id (trigger + any
 *                    metric referenced by the profile filter)
 * @param messageFor  (emailIndex) => overrides merged into that send-email's
 *                    message: template_id, subject_line, from_email, from_label, name
 */
const buildDefinition = ({ source, metricMap, messageFor }) => {
  const triggers = source.triggers.map((trigger) => {
    if (trigger.type !== 'metric') throw new Error(`Unsupported trigger type "${trigger.type}"`);
    const mapped = metricMap.get(trigger.id);
    if (!mapped) throw new Error(`No target metric mapped for trigger metric ${trigger.id}`);
    return { ...trigger, id: mapped };
  });

  const { actions, tempIds } = retargetActions(source.actions, messageFor);

  return {
    triggers,
    profile_filter: retargetProfileFilter(source.profile_filter, metricMap),
    actions,
    entry_action_id: tempIds.get(source.entry_action_id) ?? null,
    reentry_criteria: source.reentry_criteria,
  };
};

/**
 * Fails loudly if anything in the built definition still points at the source
 * account. Cheaper than discovering it after three stores are wired up wrong.
 */
const findSourceLeaks = (definition, sourceIds) => {
  const leaks = [];
  const walk = (node, path) => {
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`));
    if (node === null || typeof node !== 'object') {
      if (typeof node === 'string' && sourceIds.has(node)) leaks.push({ path, value: node });
      return;
    }
    for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`);
  };
  walk(definition, '');
  return leaks;
};

export { buildDefinition, findSourceLeaks };
