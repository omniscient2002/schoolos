/* ============================================================
   PluginSettings — L5-5.2. The generic plugin-settings form, built
   on L3-5.1's contract (server/src/settings-contract.js):

   · GET /plugins (privileged) serves each row with manifest.settingsSchema
     (camelCase kernel convention; snake_case tolerated) and, for owner/IT
     admin only, the `settings` VALUES (routes.js:1415 — non-privileged
     readers get {hasSettings, keys} + the schema, never values).
   · POST /plugins/:id/settings REPLACES the settings jsonb wholesale, so
     the client must send the full merged object — secret keys are sent
     back with their saved value when left blank (a blank input means
     "keep", not "clear"; clearing is an explicit checkbox).
   · This component mirrors L3's PURE dialect (string|integer|number|
     boolean|list, enum, default, minimum/maximum, minLength/maxLength,
     minItems/maxItems, required[], additionalProperties:false) instead of
     importing the server module across project boundaries — the two sides
     agree because the dialect is documented in settings-contract.js.
   · The door does not validate server-side YET (L3's validateSettings-
     AgainstSchema wiring pending) — this form validates as you type and
     says so; the server treats whatever arrives as truth.

   Honest-UI (D-6): secrets render write-only (never echoed back even
   though the privileged reader returns them); schema-less plugins show
   "nothing to configure"; disabled plugins can stage settings while off.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiGet, apiPost } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';
import { Badge, Button, Card, Empty, ErrorState, PageHead, Section, SkeletonCard, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { useStore } from '../state/store';

interface SettingsSchema {
  type: 'object';
  properties: Record<string, SchemaField>;
  required?: string[];
}
interface SchemaField {
  type: string;
  title?: string;
  description?: string;
  enum?: (string | number)[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  items?: { type?: string };
}
interface PluginRow {
  plugin_id: string;
  version: string | null;
  class: string | null;
  status: string;
  enabled: boolean;
  manifest: { settingsSchema?: SettingsSchema; settings_schema?: SettingsSchema } | null;
  settings?: Record<string, unknown> | null;
  enabled_at: string | null;
}

const SECRET_RE = /secret|password|token|api_?key|webhook_?signing|credential/i;
const isSecretKey = (k: string) => SECRET_RE.test(k);

const TYPE_OF: Record<string, string> = { string: 'string', integer: 'integer', number: 'number', boolean: 'boolean', array: 'list' };

/* Ordered, UI-ready field descriptors — insertion order as authored. */
function formFields(schema: SettingsSchema | null | undefined) {
  if (!schema || schema.type !== 'object' || !schema.properties) return [];
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  return Object.entries(schema.properties).map(([key, def]) => {
    const d = def ?? {};
    const humanize = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return {
      key,
      label: d.title ?? humanize(key),
      type: TYPE_OF[d.type] ?? 'string',
      required: required.has(key),
      secret: isSecretKey(key),
      default: d.default,
      description: d.description ?? '',
      enum: d.enum ?? null,
      min: d.minimum,
      max: d.maximum,
      minLength: d.minLength,
      maxLength: d.maxLength,
      minItems: d.minItems,
      maxItems: d.maxItems,
      itemType: d.items?.type ?? 'string',
    };
  });
}

type FieldState = { value: string; keep: boolean; clear: boolean; error?: string };

export default function PluginSettings() {
  const { session } = useStore();
  const canAdmin = session.roleId === 'owner' || session.roleId === 'itadmin';
  const { id } = useParams();

  const [rows, setRows] = useState<PluginRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    apiGet<{ plugins: PluginRow[] }>('/plugins')
      .then(r => { if (live) setRows(r.plugins); })
      .catch(e => { if (live) setLoadError(friendly(e)); });
    return () => { live = false; };
  }, []);

  if (!canAdmin) {
    return (
      <>
        <PageHead title="Plugin settings" sub="Plugin configuration is managed by the school owner and IT admin." />
        <Empty icon={<Icon.Lock size={24} />} title="Not your desk" sub="Settings hold provider keys and integration facts — only the owner and IT admin can open them." />
      </>
    );
  }

  const current = id && rows ? rows.find(r => r.plugin_id === id) : undefined;

  return (
    <>
      {id ? (
        <>
          {current ? (
            <>
              <PageHead
                title={`${current.manifest?.name ?? current.plugin_id} — settings`}
                sub={current.enabled ? undefined : 'This plugin is currently OFF — settings can be staged and will apply when it is switched on.'}
                actions={<Button variant="ghost" size="sm" icon={<Icon.Arrow size={14} />} onClick={() => { window.location.hash = '#/plugins/settings'; }}>All plugins</Button>}
              />
              <PluginSettingsForm pluginId={current.plugin_id} schema={current.manifest?.settingsSchema ?? current.manifest?.settings_schema ?? null} saved={current.settings ?? null} />
            </>
          ) : rows ? (
            <ErrorState title="Plugin not found" sub={`No registered plugin “${id}” on this school — check the Plugin Manager.`} />
          ) : (
            <SkeletonCard lines={8} />
          )}
        </>
      ) : (
        <>
          <PageHead title="Plugin settings" sub="Every module that declares a settings schema — values are school-scoped and every save is audited." />
          {loadError && <ErrorState title="Could not load the plugin registry" sub={loadError} onRetry={() => window.location.reload()} />}
          {!loadError && rows === null && <div className="grid grid-2"><SkeletonCard lines={5} /><SkeletonCard lines={5} /></div>}
          {!loadError && rows && (
            <Section title="Configurable plugins" sub={`${rows.filter(r => schemaOf(r)).length} of ${rows.length} registered modules declare settings`}>
              {rows.filter(r => schemaOf(r)).length === 0 && (
                <Empty icon={<Icon.Settings size={24} />} title="Nothing to configure yet"
                  sub="No plugin on this school declares a settings schema. When one does, its form appears here." />
              )}
              <div className="grid grid-2">
                {rows.filter(r => schemaOf(r)).map(r => {
                  const keys = Object.keys(schemaOf(r)!.properties);
                  const configured = (r.settings ?? null) !== null && Object.keys(r.settings ?? {}).length > 0;
                  return (
                    <Card key={r.plugin_id} head={r.manifest?.name ?? r.plugin_id}
                      actions={<Button size="sm" variant="secondary" onClick={() => { window.location.hash = `#/plugins/settings/${r.plugin_id}`; }}>Configure</Button>}>
                      <div className="u-col" style={{ padding: 'var(--s-4) var(--s-5)', gap: 8 }}>
                        <div className="u-between">
                          <span className="u-mono u-small">{r.plugin_id}</span>
                          <Badge tone={r.enabled ? 'success' : 'neutral'} dot>{r.enabled ? 'on' : 'off'}</Badge>
                        </div>
                        <div className="u-small u-muted">{keys.length} setting{keys.length === 1 ? '' : 's'}: {keys.map(k => k.replace(/_/g, ' ')).join(', ')}</div>
                        <div className="u-xs u-faint">{configured ? 'values saved — editing replaces them all' : 'no values saved yet'}</div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </Section>
          )}
        </>
      )}
    </>
  );
}

function schemaOf(r: PluginRow): SettingsSchema | null {
  const s = r.manifest?.settingsSchema ?? r.manifest?.settings_schema ?? null;
  return s && s.type === 'object' && s.properties ? s : null;
}

/* ---- the generic form ---- */
function PluginSettingsForm({ pluginId, schema, saved }: { pluginId: string; schema: SettingsSchema | null; saved: Record<string, unknown> | null }) {
  const toast = useToast();
  const fields = useMemo(() => formFields(schema), [schema]);
  const [state, setState] = useState<Record<string, FieldState>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(0);

  useEffect(() => {
    // seed from the SAVED values (never into secret inputs)
    const seed: Record<string, FieldState> = {};
    for (const f of fields) {
      const v = saved?.[f.key];
      seed[f.key] = {
        value: f.secret ? '' : v === undefined || v === null ? '' : f.type === 'list' && Array.isArray(v) ? v.join('\n') : String(v),
        keep: true, clear: false,
      };
    }
    setState(seed);
    setSavedTick(t => t + 1);
  }, [pluginId, savedTick === 0]); // re-seed when the plugin changes or after the first load

  if (!schema) {
    return (
      <Empty icon={<Icon.Settings size={24} />} title="Nothing to configure"
        sub="This plugin does not declare a settings schema — it runs on its defaults. Anything you could set here would be fiction." />
    );
  }

  const setValue = (key: string, patch: Partial<FieldState>) =>
    setState(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  const validate = (): { ok: boolean; payload: Record<string, unknown> | null } => {
    const payload: Record<string, unknown> = {};
    for (const f of fields) {
      const st = state[f.key] ?? { value: '', keep: true, clear: false };
      const raw = st.value.trim();
      if (f.secret && st.clear) continue; // key dropped entirely
      if (f.secret && raw === '') {
        if (saved?.[f.key] !== undefined && saved?.[f.key] !== null) payload[f.key] = saved[f.key]; // preserve
        else if (f.required) return { ok: false, payload: null };
        else continue;
        continue;
      }
      if (raw === '') {
        if (f.required) { setValue(f.key, { error: 'required' }); return { ok: false, payload: null }; }
        continue;
      }
      if (f.type === 'integer' || f.type === 'number') {
        const n = Number(raw);
        if (!Number.isFinite(n)) { setValue(f.key, { error: 'must be a number' }); return { ok: false, payload: null }; }
        if (f.type === 'integer' && !Number.isInteger(n)) { setValue(f.key, { error: 'must be a whole number' }); return { ok: false, payload: null }; }
        if (f.min !== undefined && n < f.min) { setValue(f.key, { error: `must be ≥ ${f.min}` }); return { ok: false, payload: null }; }
        if (f.max !== undefined && n > f.max) { setValue(f.key, { error: `must be ≤ ${f.max}` }); return { ok: false, payload: null }; }
        payload[f.key] = n;
        continue;
      }
      if (f.type === 'boolean') {
        payload[f.key] = raw === 'true';
        continue;
      }
      if (f.type === 'list') {
        const items = st.value.split('\n').map(s => s.trim()).filter(Boolean);
        if (f.minItems !== undefined && items.length < f.minItems) { setValue(f.key, { error: `needs at least ${f.minItems} item(s)` }); return { ok: false, payload: null }; }
        if (f.maxItems !== undefined && items.length > f.maxItems) { setValue(f.key, { error: `at most ${f.maxItems} item(s)` }); return { ok: false, payload: null }; }
        payload[f.key] = f.itemType === 'integer' || f.itemType === 'number' ? items.map(s => Number(s)).filter(n => Number.isFinite(n)) : items;
        continue;
      }
      // string
      if (f.enum && !f.enum.map(String).includes(raw)) { setValue(f.key, { error: 'pick one of the listed values' }); return { ok: false, payload: null }; }
      if (f.minLength !== undefined && raw.length < f.minLength) { setValue(f.key, { error: `at least ${f.minLength} characters` }); return { ok: false, payload: null }; }
      if (f.maxLength !== undefined && raw.length > f.maxLength) { setValue(f.key, { error: `at most ${f.maxLength} characters` }); return { ok: false, payload: null }; }
      payload[f.key] = f.type === 'number' ? Number(raw) : raw;
    }
    return { ok: true, payload };
  };

  const save = async () => {
    setError(null);
    const v = validate();
    if (!v.ok || !v.payload) { setError('Fix the highlighted fields — nothing was saved.'); return; }
    setBusy(true);
    try {
      await apiPost<{ plugin?: unknown }>(`/plugins/${pluginId}/settings`, v.payload);
      const secretsTouched = fields.filter(f => f.secret).length;
      toast({
        title: 'Settings saved',
        sub: `${Object.keys(v.payload).length} value${Object.keys(v.payload).length === 1 ? '' : 's'} stored for ${pluginId}${secretsTouched ? ' — secret fields were written, never displayed back' : ''}. Every save is audited.`,
        tone: 'success',
      });
    } catch (e: unknown) {
      setError(friendly((e as Error)?.message ?? 'could not save settings'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="u-col" style={{ gap: 16, maxWidth: 860, margin: '0 auto', width: '100%' }}>
      <Card head="Configuration">
        <div className="u-col" style={{ padding: 'var(--s-4) var(--s-5)', gap: 12 }}>
          {error && <div role="alert" className="u-small" style={{ color: 'var(--danger)' }}>{error}</div>}
          {fields.map(f => {
            const st = state[f.key] ?? { value: '', keep: true, clear: false };
            const inputStyle = st.error ? { borderColor: 'var(--danger)' } : undefined;
            return (
              <div key={f.key} className="u-col" style={{ gap: 4 }}>
                <label style={{ display: 'block' }}>
                  {f.label}{f.required ? ' *' : ''}{f.secret ? ' · secret' : ''}
                  {f.type === 'boolean' ? (
                    <div className="u-flex" style={{ gap: 8, alignItems: 'center', marginTop: 4 }}>
                      <input type="checkbox" checked={st.value === 'true'} onChange={e => setValue(f.key, { value: e.target.checked ? 'true' : 'false', error: undefined })} />
                      <span className="u-small u-muted">{st.value === 'true' ? 'yes' : 'no'}</span>
                    </div>
                  ) : f.enum ? (
                    <select className="select" style={{ marginTop: 4, ...(inputStyle ?? {}) }} value={st.value} onChange={e => setValue(f.key, { value: e.target.value, error: undefined })}>
                      <option value="">— pick —</option>
                      {f.enum.map(o => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
                    </select>
                  ) : f.type === 'list' ? (
                    <textarea className="input" rows={4} style={{ marginTop: 4, fontFamily: 'var(--mono)', ...(inputStyle ?? {}) }} value={st.value}
                      placeholder={`one item per line${f.default !== undefined ? ` (default: ${Array.isArray(f.default) ? f.default.join(', ') : String(f.default)})` : ''}`}
                      onChange={e => setValue(f.key, { value: e.target.value, error: undefined })} />
                  ) : (
                    <input className="input" style={{ marginTop: 4, ...(inputStyle ?? {}) }}
                      type={f.secret ? 'password' : f.type === 'integer' || f.type === 'number' ? 'number' : 'text'}
                      autoComplete={f.secret ? 'new-password' : 'off'}
                      value={st.value}
                      placeholder={f.secret ? 'leave blank to keep the saved value' : f.default !== undefined ? `default: ${String(f.default)}` : ''}
                      onChange={e => setValue(f.key, { value: e.target.value, error: undefined })} />
                  )}
                </label>
                <div className="u-xs u-faint" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  {st.error && <span style={{ color: 'var(--danger)' }}>{st.error}</span>}
                  {f.description && <span>{f.description}</span>}
                  {f.min !== undefined || f.max !== undefined ? <span>range: {f.min ?? '−∞'} … {f.max ?? '∞'}</span> : null}
                  {f.secret && (saved?.[f.key] !== undefined && saved?.[f.key] !== null) && (
                    <label className="u-flex" style={{ gap: 4, alignItems: 'center' }}>
                      <input type="checkbox" checked={st.clear} onChange={e => setValue(f.key, { clear: e.target.checked })} />
                      clear the saved value
                    </label>
                  )}
                </div>
              </div>
            );
          })}
          <div className="u-flex" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save settings'}</Button>
          </div>
          <div className="u-xs u-faint" style={{ lineHeight: 1.55 }}>
            Saving REPLACES all stored values with what this form submits — untouched fields keep their saved
            values automatically, and secret fields are preserved when left blank. The server records every
            change in the audit log.
          </div>
        </div>
      </Card>
    </div>
  );
}
