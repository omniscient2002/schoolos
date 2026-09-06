/* ============================================================
   Plugin Manager — the switchboard (kernel-owned, not a plugin).
   Enable/disable modules; every switch is audited on the server.
   ============================================================ */
import { useState } from 'react';
import { PageHead, Card, Badge, Button, Empty, useToast, KeyValue } from '../components/ui';
import { Icon } from '../components/Icon';
import { useKernel } from '../plugins/useKernel';
import { CLASS_INFO, PERMISSION_INFO } from '../plugins/pluginTypes';
import { LIVE_API, apiEnablePlugin, apiDisablePlugin } from '../services/liveApi';

export default function Plugins() {
  const { all, enabled, enable, disable, configured } = useKernel();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

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
        toast({ title: 'Server record failed', sub: (e as Error).message, tone: 'error' });
      }
    }
    toast({
      title: on ? `${all.find(p => p.id === id)?.name} enabled` : `${all.find(p => p.id === id)?.name} disabled`,
      sub: on ? 'Nav, routes and slots now include it · decision on the audit ledger' : 'Data retained · invisible everywhere · subscriptions stopped',
      tone: on ? 'success' : 'info',
    });
    setBusy(null);
  };

  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      <PageHead
        title="Plugin Manager"
        sub="Everything the school runs beyond the kernel is a switch — not a feature request"
        actions={<Badge tone="outline" dot>{enabled.size} of {all.length} enabled</Badge>}
      />

      <Card head="What the kernel always runs" sub="These are not pluggable — a school without them is not a school" style={{ marginBottom: 'var(--s-4)' }}>
        <KeyValue items={[
          { k: 'Spine', v: 'Attendance · Enrollment · Fees & payments · Approvals · Audit ledger' },
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
                        <Badge tone="outline">class {p.class} · {CLASS_INFO[p.class].label}</Badge>
                        <span className="u-xs u-faint u-mono">v{p.version}</span>
                        {configured[p.id] && (
                          <span title="Settings saved for this plugin (values visible to owner/IT admin only)" className="u-xs" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-3)' }}>
                            <Icon.Check size={11} /> configured
                          </span>
                        )}
                      </div>
                      <span className="u-small u-muted" style={{ lineHeight: 1.55 }}>{p.description}</span>
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
                <div className="u-xs u-faint">slots: {p.slots.join(' · ')}{p.eventSubscriptions?.length ? ` · subscribes: ${p.eventSubscriptions.join(', ')}` : ''}</div>
              </div>
            </Card>
          );
        })}
      </div>

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
