/* ============================================================
   PluginSettingsForm — L5-5.2, the generic settings renderer.
   Contract (L3-5.1, paired): each plugin manifest may carry a
   JSON-schema-ish `settingsSchema` (camelCase via the kernel reader;
   `settings_schema` accepted as the snake_case fallback). GET /plugins
   returns schema + current values to privileged roles (owner/itadmin);
   non-privileged rows carry ONLY {hasSettings, keys} + the schema, so
   the form renders read-only there (redteam P1-2). Save = PUT-replace of
   the whole settings object → secret-class fields keep their stored
   value when the input is left blank (blank ≠ clear, by design).
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';
import { Badge, Button, Empty } from '../components/ui';
import { Icon } from '../components/Icon';

interface SchemaField {
  type?: string;
  enum?: (string | number)[];
  default?: unknown;
  description?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  items?: { type?: string };
}
interface SettingsSchema {
  type?: string;
  properties?: Record<string, SchemaField>;
  required?: string[];
}

interface ServerPluginRow {
  plugin_id: string;
  settings?: Record<string, unknown> | null;
  settings_schema?: SettingsSchema | null;
  manifest?: { settingsSchema?: SettingsSchema; settings_schema?: SettingsSchema } | null;
}

/** Secret-class detection (L3 contract): key shape OR the field's own
    description declares it. Values are never echoed once stored. */
export function isSecretField(key: string, f: SchemaField): boolean {
  if (/(password|secret|token|_value$|_key$|apikey$|api_key$)/i.test(key)) return true;
  if (typeof f.description === 'string' && /(secret|never (surfaced|logged|echoed)|write-only)/i.test(f.description)) return true;
  return false;
}

export default function PluginSettingsForm({ pluginId, onSaved }: { pluginId: string; onSaved?: () => void }) {
  const [row, setRow] = useState<ServerPluginRow | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'demo'>('loading');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiGet<{ plugins: ServerPluginRow[] }>('/plugins');
        if (cancelled) return;
        const mine = (data.plugins ?? []).find((p) => p.plugin_id === pluginId) ?? null;
        setRow(mine);
        setState(mine ? 'ready' : 'demo');
        const cur = mine?.settings ?? {};
        setValues({ ...cur });
      } catch {
        if (!cancelled) setState('demo'); // demo mode: no live registry
      }
    })();
    return () => { cancelled = true; };
  }, [pluginId]);

  const schema: SettingsSchema | null = useMemo(
    () => row?.settings_schema ?? row?.manifest?.settingsSchema ?? row?.manifest?.settings_schema ?? null,
    [row]);
  const privileged = row ? row.settings != null : false;
  const fields = Object.entries(schema?.properties ?? {});

  /* Client-side validation mirroring L3's settings-contract dialect — the
     POST door does not validate server-side yet (help.md finding), so the
     form refuses bad values before they reach the registry. */
  const validate = (): Record<string, unknown> | null => {
    const errors: Record<string, string> = {};
    const body: Record<string, unknown> = { ...values };
    for (const [k, f] of fields) {
      const req = (schema?.required ?? []).includes(k);
      if (isSecretField(k, f)) {
        const typed = secrets[k];
        if (typed != null && typed !== '') body[k] = typed;
        else {
          // GET /plugins returns a mask for stored secrets. Never send that
          // placeholder back as a replacement; an untouched secret is a
          // write-only field and the server preserves its encrypted value.
          delete body[k];
          if (req && values[k] == null) errors[k] = 'required';
        }
        continue; // blank secret = keep the stored value (never clear)
      }
      const raw = values[k];
      if (raw == null || raw === '') {
        if (req) errors[k] = 'required';
        else delete body[k];
        continue;
      }
      if (f.type === 'number' || f.type === 'integer') {
        const n = Number(raw);
        if (!Number.isFinite(n)) { errors[k] = 'must be a number'; continue; }
        if (f.type === 'integer' && !Number.isInteger(n)) { errors[k] = 'must be a whole number'; continue; }
        if (f.minimum !== undefined && n < f.minimum) { errors[k] = `must be ≥ ${f.minimum}`; continue; }
        if (f.maximum !== undefined && n > f.maximum) { errors[k] = `must be ≤ ${f.maximum}`; continue; }
        body[k] = n;
        continue;
      }
      if (f.type === 'boolean') { body[k] = Boolean(raw); continue; }
      if (f.type === 'array') {
        const items = String(raw).split('\n').map(x => x.trim()).filter(Boolean);
        if (f.minItems !== undefined && items.length < f.minItems) { errors[k] = `needs at least ${f.minItems} item(s)`; continue; }
        if (f.maxItems !== undefined && items.length > f.maxItems) { errors[k] = `at most ${f.maxItems} item(s)`; continue; }
        body[k] = items;
        continue;
      }
      const str = String(raw);
      if (f.enum && !f.enum.map(String).includes(str)) { errors[k] = 'pick one of the listed values'; continue; }
      if (f.minLength !== undefined && str.length < f.minLength) { errors[k] = `at least ${f.minLength} characters`; continue; }
      if (f.maxLength !== undefined && str.length > f.maxLength) { errors[k] = `at most ${f.maxLength} characters`; continue; }
      body[k] = str;
    }
    setFieldErrors(errors);
    return Object.keys(errors).length ? null : body;
  };

  const save = async () => {
    setErr(null);
    const body = validate();
    if (!body) { setErr('Fix the highlighted fields — nothing was saved.'); return; }
    setBusy(true);
    try {
      // PUT replaces the whole object: start from the stored values and apply
      // edits; blank secret inputs mean "keep what is stored" (never clear).
      await apiPost<{ plugin: unknown }>(`/plugins/${pluginId}/settings`, body);
      setSecrets({});
      onSaved?.();
    } catch (e) {
      setErr(friendly((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  if (state === 'loading') return <p className="u-small u-faint">Loading settings…</p>;
  if (state === 'demo' || !schema || !fields.length) {
    return (
      <Empty
        icon={<Icon.Settings size={18} />}
        title={state === 'demo' ? 'Settings live on the server' : 'Nothing to configure'}
        sub={state === 'demo'
          ? 'Run SchoolOS against the live API to manage this feature\'s settings here.'
          : 'This feature works out of the box — no settings needed.'}
      />
    );
  }

  return (
    <div className="u-col roll" style={{ gap: 12 }}>
      {!privileged && (
        <p className="u-small" style={{ color: 'var(--text-2)' }}>
          You can see that settings exist, but only the <strong>owner</strong> or <strong>IT admin</strong> can view or edit the values.
        </p>
      )}
      {fields.map(([key, f]) => {
        const secret = isSecretField(key, f);
        const current = values[key];
        const id = `pf-${pluginId}-${key}`;
        const label = key.replace(/_/g, ' ');
        return (
          <div key={key} className="u-col" style={{ gap: 4 }}>
            <label htmlFor={id} className="u-small" style={{ fontWeight: 600 }}>
              {label}
              {(schema?.required ?? []).includes(key) && <span style={{ color: 'var(--danger)' }}> *</span>}
              {secret && <Badge tone="outline">secret</Badge>}
            </label>
            {f.enum ? (
              <select
                id={id}
                disabled={!privileged}
                value={String(current ?? f.default ?? '')}
                onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                style={{ maxWidth: 360 }}
              >
                {f.enum.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.type === 'boolean' ? (
              <input
                id={id}
                type="checkbox"
                disabled={!privileged}
                checked={Boolean(current ?? f.default ?? false)}
                onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.checked }))}
              />
            ) : secret ? (
              <input
                id={id}
                type="password"
                disabled={!privileged}
                autoComplete="new-password"
                placeholder={privileged ? '••••••••  (leave blank to keep the saved value)' : 'stored on the server'}
                value={secrets[key] ?? ''}
                onChange={(e) => setSecrets((s) => ({ ...s, [key]: e.target.value }))}
                style={{ maxWidth: 360 }}
              />
            ) : f.type === 'array' ? (
              <textarea
                id={id}
                rows={4}
                disabled={!privileged}
                value={Array.isArray(current) ? current.join('\n') : current == null ? '' : String(current)}
                onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                placeholder="one item per line"
                style={{ maxWidth: 360, fontFamily: 'var(--mono)' }}
              />
            ) : (
              <input
                id={id}
                type={f.type === 'number' || f.type === 'integer' ? 'number' : 'text'}
                disabled={!privileged}
                value={current == null ? '' : String(current)}
                onChange={(e) => setValues((v) => ({ ...v, [key]: f.type === 'number' || f.type === 'integer' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value }))}
                style={{ maxWidth: 360 }}
              />
            )}
            {(fieldErrors[key] || f.description) && (
              <span className="u-xs" style={{ color: fieldErrors[key] ? 'var(--danger)' : undefined, lineHeight: 1.5 }}>
                {fieldErrors[key] ?? f.description}
              </span>
            )}
          </div>
        );
      })}
      {err && <p className="u-small" style={{ color: 'var(--danger)' }}>{err}</p>}
      {privileged && (
        <div>
          <Button size="sm" loading={busy} onClick={save}>Save settings</Button>
          <span className="u-xs u-faint" style={{ marginLeft: 10 }}>Blank secret fields keep the saved value. Every save is recorded in the activity log.</span>
        </div>
      )}
    </div>
  );
}
