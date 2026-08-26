/**
 * Transforms a flow definition fetched from one Klaviyo account into one that
 * can be POSTed to another.
 *
 * Two kinds of id live in a definition and they need opposite treatment:
 *
 *   - Ids of objects *inside* the flow (actions, paths, triggers) belong to the
 *     source account. They are stripped and replaced with `temporary_id`, which
 *     is how the create endpoint identifies not-yet-existing objects. The same
 *     id can be referenced from elsewhere in the definition, so one id always
 *     maps to one temporary_id.
 *   - Ids that *reference* other resources in the account -- a template id on a
 *     send-email action, a list or metric id on the trigger -- point at objects
 *     that already exist separately in the target account. Turning those into
 *     temporary_ids would be wrong; they have to be remapped to the equivalent
 *     object in the target account, or the flow will send the source store's
 *     emails from the target store.
 */

/** Field names whose value points at a resource outside the flow, not at a node within it. */
const CROSS_REFERENCE_FIELDS = new Set([
  'template_id',
  'list_id',
  'metric_id',
  'segment_id',
  'catalog_id',
  'tag_id',
]);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Walks the definition, replacing every node `id` with a `temporary_id` and
 * recording the mapping so references can be rewritten in a second pass.
 */
const collectNodeIds = (node, mapping) => {
  if (Array.isArray(node)) {
    node.forEach((n) => collectNodeIds(n, mapping));
    return;
  }
  if (!isPlainObject(node)) return;

  if (typeof node.id === 'string' && !mapping.has(node.id)) {
    mapping.set(node.id, `tmp_${mapping.size + 1}`);
  }
  for (const value of Object.values(node)) collectNodeIds(value, mapping);
};

const rewrite = (node, mapping, crossReferences) => {
  if (Array.isArray(node)) return node.map((n) => rewrite(n, mapping, crossReferences));
  if (!isPlainObject(node)) return node;

  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'id' && typeof value === 'string' && mapping.has(value)) {
      out.temporary_id = mapping.get(value);
      continue;
    }
    if (CROSS_REFERENCE_FIELDS.has(key) && typeof value === 'string') {
      // A cross-reference may coincide with a node id in the mapping; the
      // field name wins, because the value points outside the flow.
      out[key] = crossReferences.has(value) ? crossReferences.get(value) : value;
      continue;
    }
    if (typeof value === 'string' && mapping.has(value)) {
      out[key] = mapping.get(value);
      continue;
    }
    out[key] = rewrite(value, mapping, crossReferences);
  }
  return out;
};

/**
 * @param definition  flow definition as returned by
 *                    GET /api/flows/:id?additional-fields[flow]=definition
 * @param crossReferences  Map of source-account resource id -> target-account id
 * @returns { definition, mapping, unresolved }  `unresolved` lists cross-reference
 *          values that had no mapping and would still point at the source account.
 */
const retargetDefinition = (definition, crossReferences = new Map()) => {
  const mapping = new Map();
  collectNodeIds(definition, mapping);

  // A cross-referenced id must never be treated as an in-flow node id.
  for (const sourceId of crossReferences.keys()) mapping.delete(sourceId);

  const rewritten = rewrite(definition, mapping, crossReferences);
  const unresolved = findUnresolved(definition, crossReferences);
  return { definition: rewritten, mapping, unresolved };
};

const findUnresolved = (node, crossReferences, found = []) => {
  if (Array.isArray(node)) {
    node.forEach((n) => findUnresolved(n, crossReferences, found));
    return found;
  }
  if (!isPlainObject(node)) return found;

  for (const [key, value] of Object.entries(node)) {
    if (CROSS_REFERENCE_FIELDS.has(key) && typeof value === 'string' && !crossReferences.has(value)) {
      found.push({ field: key, value });
    }
    findUnresolved(value, crossReferences, found);
  }
  return found;
};

export { retargetDefinition, CROSS_REFERENCE_FIELDS };
