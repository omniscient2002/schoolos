/* ============================================================
   PluginSettings — L5-5.2. The settings hub: every registered
   plugin that declares a settingsSchema, with the shared generic
   form (src/plugins/PluginSettingsForm.tsx) rendered per plugin.

   Data contract (server, routes.js): GET /plugins serves each row
   with manifest.settingsSchema (camelCase kernel convention) and,
   for owner/IT admin only, the `settings` VALUES — non-privileged
   readers get {hasSettings, keys} + the schema, never values
   (redteam P1-2). POST /plugins/:id/settings REPLACES the settings
   jsonb wholesale; the shared form compensates (blank secret =
   keep the saved value) and validates client-side (L3-5.1 dialect)
   because the door does not validate server-side yet (help.md).

   This screen is owner + IT admin (the only roles the save door
   accepts); staffOnly routing keeps light roles out entirely.
   ============================================================ */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiGet } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';
import { Badge, Button, Card, Empty, ErrorState, PageHead, Section, SkeletonCard } from '../components/ui';
import { Icon } from '../components/Icon';
import { useStore } from '../state/store';
import PluginSettingsForm from '../plugins/PluginSettingsForm';

interface SettingsSchema { type: string; properties: Record<string, unknown> }
interface PluginRow {
  plugin_id: string;
  version: string | null;
  class: string | null;
  status: string;
  enabled: boolean;
  manifest: { name?: string; settingsSchema?: SettingsSchema; settings_schema?: SettingsSchema } | null;
  settings?: Record<string, unknown> | null;
}

function schemaOf(r: PluginRow): SettingsSchema | null {
  const s = r.manifest?.settingsSchema ?? r.manifest?.settings_schema ?? null;
  return s && s.type === 'object' && s.properties ? s : null;
}

export default function PluginSettings() {
  const { session } = useStore();
  const navigate = useNavigate();
  const canAdmin = session.roleId === 'owner' || session.roleId === 'itadmin';
  const { id } = useParams();

  const [rows, setRows] = useState<PluginRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(0);

  useEffect(() => {
    let live = true;
    apiGet<{ plugins: PluginRow[] }>('/plugins')
      .then(r => { if (live) setRows(r.plugins); })
      .catch(e => { if (live) setLoadError(friendly(e)); });
    return () => { live = false; };
  }, [savedTick]);

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
                actions={<Button variant="ghost" size="sm" onClick={() => navigate('/plugins/settings')}>All plugins</Button>}
              />
              <div style={{ maxWidth: 860, margin: '0 auto', width: '100%' }}>
                <Card head="Configuration">
                  <div style={{ padding: 'var(--s-4) var(--s-5)' }}>
                    <PluginSettingsForm pluginId={current.plugin_id} onSaved={() => setSavedTick(t => t + 1)} />
                  </div>
                </Card>
              </div>
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
          {loadError && <ErrorState title="Could not load the plugin registry" sub={loadError} onRetry={() => setSavedTick(t => t + 1)} />}
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
                      actions={<Button size="sm" variant="secondary" onClick={() => navigate(`/plugins/settings/${r.plugin_id}`)}>Configure</Button>}>
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
