/* ============================================================
   Plugin Manager — the switchboard (kernel-owned, not a plugin).
   Enable/disable modules; every switch is audited on the server.
   ============================================================ */
import { useState } from 'react';
import { PageHead, Card, Badge, Button, Empty, useToast, KeyValue } from '../components/ui';
import { Icon } from '../components/Icon';
import { useKernel } from '../plugins/useKernel';
import { CLASS_INFO, PERMISSION_INFO } from '../plugins/pluginTypes';
import { BUILT_IN_CAPABILITIES } from '../plugins/pluginRegistry';
import PluginSettingsForm from '../plugins/PluginSettingsForm';
import { LIVE_API, apiEnablePlugin, apiDisablePlugin } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';

/* Live mode renders SERVER manifest names/descriptions verbatim; those are
   contract prose, not copy. This display-only map keeps the cards plain for
   both demo and live (unit 18, rule 4) — ids never change. */
const FRIENDLY: Record<string, { name?: string; description?: string }> = {
  'comms.whatsapp': { description: 'WhatsApp messages to parents — fee receipts, attendance notes and delay alerts, sent from approved templates only.' },
  'payments.upi': { description: 'Collect fees with UPI payment links. Parents pay in one tap; the school office confirms the money arrived.' },
  'transport.gps': { description: 'Bus GPS tracking + delay alerts. Parents are told automatically when a bus runs 10 minutes late.' },
  'ops.timetable': { description: 'Class timetable & substitutions. Set the weekly grid and find a substitute teacher in one click.' },
  'library': { description: 'Library books: catalog, issue and return, and overdue reminders. Switch it on and it appears in the menu; switch it off and it disappears.' },
  'admissions.funnel': { description: 'Track admission enquiries from first call to enrolled. Keeps applicant details private and separate from student records.' },
  'ops.visitors': { description: 'Visitor gate passes: the front desk prints a badge, and a student only leaves when the guardian confirms with a code. Safety first — release always needs verification.' },
};

export default function Plugins() {
  const { all, enabled, enable, disable, configured } = useKernel();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState<string | null>(null);
  // intersect: a stale mirror (or retired ids in localStorage) must not
  // make the badge claim more enabled plugins than exist
  const enabledCount = all.filter(p => enabled.has(p.id)).length;

  const toggle = async (id: string, on: boolean) => {
    setBusy(id);
    // local kernel flips instantly (UX); server records the decision when live
    if (on) enable(id); else disable(id);
    if (LIVE_API) {
      try {
        const m = all.find(p => p.id === id)!;
        if (on) await apiEnablePlugin(id, m.version, m.class, m.permissions);
        else await apiDisablePlugin(id);
      } catch (e) {
        toast({ title: 'Could not save this change', sub: friendly((e as Error).message), tone: 'error' });
      }
    }
    toast({
      title: on ? `${all.find(p => p.id === id)?.name} switched on` : `${all.find(p => p.id === id)?.name} switched off`,
      sub: on ? 'It now appears in the menu. This change is recorded in the activity log.' : 'Data is saved and the feature disappears until you switch it back on.',
      tone: on ? 'success' : 'info',
    });
    setBusy(null);
  };

  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      <PageHead
        title="Plugin Manager"
        sub="Every extra feature is a simple on/off switch — core features are always on"
        actions={<Badge tone="outline" dot>{enabledCount} of {all.length} enabled</Badge>}
      />

      <Card head="Always on" sub="The essential parts of SchoolOS — attendance, enrollment, fees, approvals and records. These are always on." style={{ marginBottom: 'var(--s-4)' }}>
        <KeyValue items={[
          { k: 'The essentials', v: 'Attendance · Enrollment · Fees & payments · Approvals · Activity log' },
          { k: 'Trust', v: 'Guardian verification · Communication receipts · Role scoping (RLS)' },
          { k: 'Platform', v: 'This Plugin Manager · entitlements · plugin audit' },
        ]} cols={1} />
      </Card>

      <div className="u-col" style={{ gap: 12 }}>
        {all.map(p => {
          const on = enabled.has(p.id);
          const I = Icon[p.icon as keyof typeof Icon] ?? Icon.Database;
          return (
            <Card key={p.id} style={{ borderTop: `3px solid ${on ? 'var(--success)' : 'var(--border-subtle)'}` }}>
              <div className="u-col" style={{ gap: 10 }}>
                <div className="u-between" style={{ gap: 10, flexWrap: 'wrap' }}>
                  <div className="u-inline" style={{ gap: 12, minWidth: 0 }}>
                    <span style={{ width: 38, height: 38, borderRadius: 12, background: on ? 'color-mix(in srgb, var(--success) 10%, transparent)' : 'var(--surface-3)', color: on ? 'var(--accent-text)' : 'var(--text-3)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><I size={18} /></span>
                    <div className="u-col" style={{ gap: 2 }}>
                      <div className="u-inline" style={{ gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 650 }}>{p.name}</span>
                        <Badge tone="outline">{CLASS_INFO[p.class].label}</Badge>
                        <span className="u-xs u-faint u-mono">v{p.version}</span>
                        {configured[p.id] && (
                          <span title="Settings saved for this feature (only the owner and IT admin can see the values)" className="u-xs" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-3)' }}>
                            <Icon.Check size={11} /> configured
                          </span>
                        )}
                      </div>
                      <span className="u-small u-muted" style={{ lineHeight: 1.55 }}>{(FRIENDLY[p.id]?.description ?? p.description)}</span>
                    </div>
                  </div>
                  <Button size="sm" variant={on ? 'secondary' : 'primary'} loading={busy === p.id} onClick={() => toggle(p.id, !on)}>
                    {on ? 'Disable' : 'Enable'}
                  </Button>
                </div>

                <div className="u-inline" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {p.permissions.map(per => (
                    <span key={per} title={PERMISSION_INFO[per]} className="u-xs u-mono" style={{ padding: '3px 8px', borderRadius: 999, border: '1px solid var(--border-subtle)', color: 'var(--text-2)' }}>{per}</span>
                  ))}
                </div>
                <div className="u-xs u-faint">Shows up in: {p.slots.join(' · ')}{p.eventSubscriptions?.length ? ` · reacts to: ${p.eventSubscriptions.join(', ')}` : ''}</div>

                {/* L5-5.2: schema-driven settings (paired with L3-5.1's contract).
                    Rendered from the SERVER manifest's settingsSchema; the form
                    itself enforces the secret-masking + role rules. */}
                {p.slots.includes('settings') && (
                  <div style={{ borderTop: '1px dashed var(--border-subtle)', paddingTop: 10 }}>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setSettingsOpen(settingsOpen === p.id ? null : p.id)}
                    >
                      <span className="u-inline" style={{ gap: 6, alignItems: 'center' }}>
                        <Icon.Settings size={13} />
                        {settingsOpen === p.id ? 'Hide settings' : (configured[p.id] ? 'Edit settings' : 'Settings')}
                      </span>
                    </Button>
                    {settingsOpen === p.id && (
                      <div style={{ marginTop: 12 }}>
                        <PluginSettingsForm pluginId={p.id} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Built-in core capabilities — ruling 2026-09-06: the plugin grid shows
          ONLY server-registered plugins; core lives here, static, no switches. */}
      <Card head="Built into the school core" sub="Core capabilities — always on, included with SchoolOS" style={{ marginTop: 'var(--s-4)' }}>
        <div className="u-col" style={{ gap: 12 }}>
          {BUILT_IN_CAPABILITIES.map(c => {
            const I = Icon[c.icon as keyof typeof Icon] ?? Icon.Database;
            return (
              <div key={c.id} className="u-between" style={{ gap: 12, flexWrap: 'wrap', borderBottom: '1px solid var(--border-subtle)', paddingBottom: 10 }}>
                <div className="u-inline" style={{ gap: 10, minWidth: 0 }}>
                  <span style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--surface-3)', color: 'var(--text-3)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><I size={16} /></span>
                  <div className="u-col" style={{ gap: 2 }}>
                    <span style={{ fontWeight: 600 }}>{c.name}</span>
                    <span className="u-xs u-faint" style={{ lineHeight: 1.5, maxWidth: 640 }}>{c.description}</span>
                  </div>
                </div>
                <Badge tone="outline">built-in</Badge>
              </div>
            );
          })}
        </div>
      </Card>

      <Card head="Third-party extensions (class E)" sub="Not yet open — and that is deliberate" style={{ marginTop: 'var(--s-4)' }}>
        <Empty
          icon={<Icon.Lock size={20} />}
          title="The marketplace gate is closed by design"
          sub="Out-of-process plugins arrive only with signed requests, scoped tokens, an egress allowlist and the same audit contract. The seam is ready; the review process is what ships next."
        />
      </Card>
    </div>
  );
}
