/* ============================================================
   Kernel runtime — enable/disable plugins for this school.
   One switch → nav, routes, slots and subscriptions all change.
   Server table is the truth of record; localStorage mirrors it
   for instant UX. URL override
   `?plugins=library,transport` supports scripted demos.
   ============================================================ */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { FIRST_PARTY_PLUGINS, KERNEL_VERSION } from './pluginRegistry';
import type { PluginManifest } from './pluginTypes';
import { Empty } from '../components/ui';
import { Icon } from '../components/Icon';
import { Link } from 'react-router-dom';

const LS_KEY = 'schoolos.plugins.v1';

function loadEnabled(): Set<string> {
  const defaults = FIRST_PARTY_PLUGINS.filter(p => p.defaultEnabled).map(p => p.id);
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch { /* fall through to defaults */ }
  return new Set(defaults);
}

function urlOverride(): string[] | null {
  const q = new URLSearchParams(window.location.search).get('plugins');
  return q ? q.split(',').map(s => s.trim()).filter(Boolean) : null;
}

interface KernelCtx {
  enabled: Set<string>;
  /** Server-reported per-plugin "settings exist" flag. The registry strips
      setting VALUES for non-owner roles (redteam P1-2) — this is the only
      settings-related signal the UI may show. */
  configured: Record<string, boolean>;
  isEnabled: (id: string) => boolean;
  enable: (id: string) => void;
  disable: (id: string) => void;
  manifestFor: (id: string) => PluginManifest | undefined;
  all: PluginManifest[];
}

const Ctx = createContext<KernelCtx | null>(null);

export function KernelProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState<Set<string>>(loadEnabled);
  const [configured, setConfigured] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const o = urlOverride();
    if (o) setEnabled(new Set(o));
  }, []);

  // docs/11 §8: when running against the live API, the server plugin table is
  // the truth of record — the kernel re-syncs enablement from it on load, so an
  // owner toggling in another tab (or a drain) is honored on next mount.
  useEffect(() => {
    /* plugins always sync from the server registry (single brain) */
    let cancelled = false;
    (async () => {
      try {
        const token = localStorage.getItem('schoolos_token');
        if (!token) return;
        // Same-origin deploy contract (orchestrator verdict, 2026-09-06): the
        // relative fetch is intentional — API serves the app / VITE_API_BASE is
        // pinned at build. Split-origin serving is a hardening-backlog item.
        const res = await fetch('/plugins', { headers: { authorization: `Bearer ${token}` } });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const rows: Array<{ plugin_id: string; enabled: boolean; configured?: boolean; settings?: unknown }> = Array.isArray(data.plugins) ? data.plugins : [];
        if (!rows.length || cancelled) return;
        const live = new Set(rows.filter(r => r.enabled).map(r => r.plugin_id));
        // configured = server's flag (non-privileged rows) or settings-key presence
        // (privileged rows get raw settings; we count keys, never surface values)
        setConfigured(Object.fromEntries(rows.map(r => [
          r.plugin_id,
          r.configured === true || (r.settings != null && typeof r.settings === 'object' && Object.keys(r.settings as object).length > 0),
        ])));
        setEnabled(prev => {
          const next = new Set<string>([...prev].filter(id => live.has(id)));
          for (const id of live) if (FIRST_PARTY_PLUGINS.some(p => p.id === id)) next.add(id);
          if (!urlOverride()) localStorage.setItem(LS_KEY, JSON.stringify([...next]));
          return next;
        });
      } catch { /* offline or mock — localStorage mirror stays authoritative */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const value = useMemo<KernelCtx>(() => ({
    enabled,
    configured,
    isEnabled: id => enabled.has(id),
    enable: id => setEnabled(prev => {
      const next = new Set(prev); next.add(id);
      if (!urlOverride()) localStorage.setItem(LS_KEY, JSON.stringify([...next]));
      return next;
    }),
    disable: id => setEnabled(prev => {
      const next = new Set(prev); next.delete(id);
      if (!urlOverride()) localStorage.setItem(LS_KEY, JSON.stringify([...next]));
      return next;
    }),
    manifestFor: id => FIRST_PARTY_PLUGINS.find(p => p.id === id),
    all: FIRST_PARTY_PLUGINS,
  }), [enabled, configured]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useKernel(): KernelCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useKernel outside KernelProvider');
  return c;
}

/** Filter nav items by plugin enablement. Explicit tag wins; else derive from route registry. */
export function useKernelNav<T extends { to: string; plugin?: string }>(items: T[]): T[] {
  const { isEnabled } = useKernel();
  return items.filter(i => {
    if (i.plugin) return isEnabled(i.plugin);
    const owner = pluginForPath(i.to);
    return !owner || isEnabled(owner);
  });
}

function pluginForPath(path: string): string | null {
  for (const m of FIRST_PARTY_PLUGINS) {
    for (const r of m.routes ?? []) {
      if (path === r.path || path.startsWith(r.path + '/')) return m.id;
    }
  }
  return null;
}

/** Gate a route on plugin enablement. */
export function KernelGate({ plugin, children }: { plugin: string; children: ReactNode }) {
  const { isEnabled, manifestFor } = useKernel();
  const m = manifestFor(plugin);
  if (isEnabled(plugin)) return <>{children}</>;
  return (
    <div style={{ maxWidth: 640, margin: '0 auto', paddingTop: 'var(--s-8)' }}>
      <Empty
        titleAs="h1"
        icon={<Icon.Database size={22} />}
        title={`${m?.name ?? plugin} is not enabled for your school`}
        sub="This module is a plugin. An owner can switch it on in the Plugin Manager — data is retained when off, and nothing appears in nav, routes or attention while disabled."
        action={<Link to="/plugins" className="btn btn-primary">Open Plugin Manager</Link>}
      />
    </div>
  );
}

export { KERNEL_VERSION };
