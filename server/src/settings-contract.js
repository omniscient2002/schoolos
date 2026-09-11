// settings-contract.js — L3-5.1: the plugin-settings schema → form contract.
//
// WHY: plugin manifests declare a settings JSON-schema (kernel convention: the
// camelCase `settingsSchema` key — routes.js:1358 serves it), but nothing turned
// those declarations into a form the UI could render or a validation the server
// could enforce. Six+ plugins shipped settings nobody could configure without
// reading their source. This module is the ONE implementation both sides use:
//   · server doors validate incoming settings against the manifest's schema,
//   · the UI renders fields from formFieldsFromSchema instead of hardcoding forms,
//   · both agree because they import the same functions (no drift by construction).
//
// Deliberately PURE: no DB, no Fastify, no kernel imports — importable from
// plugins, routes.js, and browser-side code alike. Secrets: keys matching the
// secret pattern are validated like strings but FLAGGED secret:true so UIs render
// write-only inputs and logs never echo values.
//
// Schema dialect (what manifests actually use — a strict JSON-Schema subset):
//   type: object, properties: { key: { type: string|integer|number|boolean|array,
//         enum?: [...], default?, description?, minimum?, maximum?, minLength?,
//         maxLength?, minItems?, maxItems?, items?: {type: string,...} } },
//   required?: [keys], additionalProperties?: false (default: false — the manifest
//   is the contract; unknown keys are refused, not silently stored).

const SECRET_KEY_RE = /secret|password|token|api_?key|webhook_?signing|credential/i;

export function isSecretKey(key) {
  return SECRET_KEY_RE.test(String(key));
}

/* The manifest's schema wherever it hides (camelCase convention, snake_case tolerated). */
export function canonicalSchema(manifest) {
  if (!manifest || typeof manifest !== 'object') return null;
  const schema = manifest.settingsSchema ?? manifest.settings_schema ?? null;
  if (!schema || schema.type !== 'object' || typeof schema.properties !== 'object') return null;
  return schema;
}

const TYPE_OF = {
  string: 'string',
  integer: 'integer',
  number: 'number',
  boolean: 'boolean',
  array: 'list',
};

/* Ordered, UI-ready field descriptors. `required` rides the schema's required[]
   list; order follows the schema's property insertion order (manifests author
   them in the order the form should show). */
export function formFieldsFromSchema(schema) {
  if (!schema) return [];
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const fields = [];
  for (const [key, def] of Object.entries(schema.properties ?? {})) {
    const d = def ?? {};
    const base = {
      key,
      label: d.title ?? humanize(key),
      type: TYPE_OF[d.type] ?? 'string',
      required: required.has(key),
      default: d.default,
      description: d.description ?? null,
      secret: isSecretKey(key),
    };
    if (base.type === 'string') {
      base.maxLength = d.maxLength ?? 512;
      base.multiline = d.format === 'multiline' || d.format === 'textarea';
    }
    if (base.type === 'integer' || base.type === 'number') {
      base.min = d.minimum;
      base.max = d.maximum;
    }
    if (Array.isArray(d.enum)) {
      base.type = 'choice';
      base.options = d.enum.map((v) => ({ value: v, label: humanize(String(v)) }));
    }
    if (base.type === 'list') {
      base.itemType = TYPE_OF[d.items?.type] ?? 'string';
      base.minItems = d.minItems ?? 0;
      base.maxItems = d.maxItems ?? 50;
    }
    fields.push(base);
  }
  return fields;
}

function humanize(key) {
  return String(key)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/* Validate + normalize a settings payload against the schema. Returns
   { ok, errors:[{key,error}], normalized } — normalized carries ONLY schema-known
   keys with defaults filled in; secrets are NOT masked here (the caller stores
   them) but `secretKeys[]` is returned so read doors can strip them. */
export function validateSettingsAgainstSchema(schema, values) {
  const errors = [];
  if (!schema) return { ok: true, errors: [], normalized: { ...(values ?? {}) }, secretKeys: [] };
  if (values === null || values === undefined) values = {};
  if (typeof values !== 'object' || Array.isArray(values)) {
    return { ok: false, errors: [{ key: null, error: 'settings must be a JSON object' }], normalized: {}, secretKeys: [] };
  }
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const props = schema.properties ?? {};
  const normalized = {};
  const secretKeys = [];
  for (const key of Object.keys(values)) {
    if (!(key in props)) {
      errors.push({ key, error: `"${key}" is not a setting this module declares — check its manifest` });
      continue;
    }
    const v = validateOne(key, props[key], values[key], errors);
    if (v !== undefined) normalized[key] = v;
    if (isSecretKey(key)) secretKeys.push(key);
  }
  for (const key of required) {
    if (normalized[key] === undefined && props[key]?.default === undefined) {
      errors.push({ key, error: `"${humanize(key)}" is required` });
    }
  }
  for (const [key, def] of Object.entries(props)) {
    if (normalized[key] === undefined && def?.default !== undefined) normalized[key] = structuredClone(def.default);
  }
  return { ok: errors.length === 0, errors, normalized, secretKeys };
}

function validateOne(key, def, value, errors) {
  const type = def?.type ?? 'string';
  const fail = (error) => { errors.push({ key, error }); return undefined; };
  if (value === undefined || value === null) {
    if (def?.default !== undefined) return structuredClone(def.default);
    return undefined; // absent optional — the required sweep (after the loop) is the single authority for mandates
  }
  switch (type) {
    case 'string': {
      if (typeof value !== 'string') return fail(`"${humanize(key)}" must be text`);
      const max = def.maxLength ?? 512;
      if (value.length > max) return fail(`"${humanize(key)}" must stay under ${max} characters`);
      const min = def.minLength ?? 0;
      if (value.trim().length < min) return fail(`"${humanize(key)}" must be at least ${min} characters`);
      if (def.pattern && !new RegExp(def.pattern).test(value)) return fail(`"${humanize(key)}" is not in the expected shape`);
      return value.trim();
    }
    case 'integer': {
      const n = Number(value);
      if (!Number.isInteger(n)) return fail(`"${humanize(key)}" must be a whole number`);
      if (def.minimum != null && n < def.minimum) return fail(`"${humanize(key)}" must be at least ${def.minimum}`);
      if (def.maximum != null && n > def.maximum) return fail(`"${humanize(key)}" must be at most ${def.maximum}`);
      return n;
    }
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) return fail(`"${humanize(key)}" must be a number`);
      if (def.minimum != null && n < def.minimum) return fail(`"${humanize(key)}" must be at least ${def.minimum}`);
      if (def.maximum != null && n > def.maximum) return fail(`"${humanize(key)}" must be at most ${def.maximum}`);
      return n;
    }
    case 'boolean':
      if (typeof value !== 'boolean') return fail(`"${humanize(key)}" must be true or false`);
      return value;
    case 'array': {
      if (!Array.isArray(value)) return fail(`"${humanize(key)}" must be a list`);
      const maxItems = def.maxItems ?? 50;
      if (value.length > maxItems) return fail(`"${humanize(key)}" must hold at most ${maxItems} entries`);
      if ((def.minItems ?? 0) > value.length) return fail(`"${humanize(key)}" needs at least ${def.minItems} entries`);
      const itemType = def.items?.type ?? 'string';
      const out = [];
      for (const item of value) {
        if (itemType === 'string') {
          if (typeof item !== 'string') return fail(`"${humanize(key)}" entries must be text`);
          out.push(item.trim());
        } else if (itemType === 'integer') {
          const n = Number(item);
          if (!Number.isInteger(n)) return fail(`"${humanize(key)}" entries must be whole numbers`);
          out.push(n);
        } else if (itemType === 'object') {
          if (typeof item !== 'object' || Array.isArray(item)) return fail(`"${humanize(key)}" entries must be objects`);
          out.push(item);
        } else {
          out.push(item);
        }
      }
      return out;
    }
    default:
      return value;
  }
}

/* The required sweep inside validateSettingsAgainstSchema is the single authority
   for mandated keys; no WeakMap bookkeeping needed. Kept as a no-op export for
   API stability if callers imported it early. */
export function bindRequiredForValidation(schema) {
  return schema;
}

/* ── door wiring for plugins (L3-5.1 demonstration surface) ──────────────────────
   Mounts two doors on a plugin's own namespace:
     GET  /plugins/<id>/settings-form          → UI-ready field descriptors
     POST /plugins/<id>/settings-form/validate → pre-save validation (never persists)
   Both are owner/itadmin-tier (settings are the admin surface — the kernel's
   /plugins door already strips VALUES from non-privileged readers, and this door
   deliberately returns NO stored values at all, so the kernel settings PUT stays
   the single writer and secrets keep exactly one read path). */
export function registerSettingsFormDoors(app, kernel, pluginId, manifestDef) {
  const { require } = kernel;
  const schema = canonicalSchema(manifestDef);
  const fields = formFieldsFromSchema(schema);
  app.get(`/plugins/${pluginId}/settings-form`, { preHandler: require('owner', 'itadmin') }, async () => ({
    pluginId,
    fields,
    note: 'Values are NOT served here — read them from GET /plugins (privileged) and save via the kernel settings door. secret:true fields must render write-only.',
  }));
  app.post(`/plugins/${pluginId}/settings-form/validate`, { preHandler: require('owner', 'itadmin') }, async (req) => {
    const result = validateSettingsAgainstSchema(schema, req.body ?? {});
    return { ok: result.ok, errors: result.errors, secretKeys: result.secretKeys }; // normalized NOT returned — never echo secret values
  });
}
