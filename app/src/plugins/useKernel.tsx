/* ============================================================
   Kernel runtime — enable/disable plugins for this school.
   One switch → nav, routes, slots and subscriptions all change.
   Server table is the truth of record; localStorage mirrors it
   for instant UX. URL override
   `?plugins=library,transport` supports scripted demos.
   ============================================================ */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { FIRST_PARTY_PLUGINS, KERNEL_VERSION } from './pluginRegistry';
import { LIVE_API, LIVE_BASE, apiEnablePlugin, getToken, authHeaders } from '../services/liveApi';
import { useSession } from '../App';
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

interface KernelCtx {
  enabled: Set<string>;
  /** Server-reported per-plugin "settings exist" flag. The registry strips
      setting VALUES for non-owner roles (redteam P1-2) — this is the only
      settings-related signal the UI may show. */
  configured: Record<string, boolean>;
  available: Record<string, boolean>;
  requiredPlan: Record<string, string | null>;
  isEnabled: (id: string) => boolean;
  enable: (id: string) => void;
  disable: (id: string) => void;
  manifestFor: (id: string) => PluginManifest | undefined;
  all: PluginManifest[];
}

interface ServerPluginRow {
  plugin_id: string;
  version?: string;
  class?: string;
  status?: string;
  enabled?: boolean;
  manifest?: { name?: string; label?: string; version?: string; description?: string; permissions?: string[]; slots?: string[]; dependsOn?: string[] };
  permissions?: string[];
  configured?: boolean;
  settings?: unknown;
  available?: boolean;
  requiredPlan?: string | null;
}

/**
 * KERNEL-1 — the server's `app.plugins` table is the ONLY list of record.
 *
 * `all` used to be `FIRST_PARTY_PLUGINS`, a hand-maintained copy that had drifted:
 * it named 19 ids while the server registered 29, and 12 of the missing ones are
 * load-bearing (teacher.classroom, exams.assessment, student.world, parent.assistant,
 * coord.view, teacher.copilot, teacher.support, health.clinic, hr.leave, family.view,
 * accounting.tally, pack.cbse, pack.dpdp). Consequences, all observed through the UI:
 *   - the Add-ons board rendered 11 cards and never listed the rest, so a school
 *     could not switch them on at all;
 *   - `setEnabled` dropped every server-enabled id that FIRST_PARTY_PLUGINS did not
 *     name, so even a plugin enabled out-of-band (seed, migration, API) was treated
 *     as OFF by the client and its screens stayed hidden;
 *   - the copy had already drifted on naming (`exams` vs the server's
 *     `exams.assessment`, a `transport`/`maintenance` pair that are built-in
 *     capabilities rather than plugins).
 * The registry is now used only to ENRICH a server row (icon, friendly name,
 * description); a plugin the client has never heard of is still listed, still
 * switchable, and still rendered with the manifest the server sent.
 */
function manifestsFromServer(rows: ServerPluginRow[]): PluginManifest[] {
  const local = new Map(FIRST_PARTY_PLUGINS.map((p) => [p.id, p]));
  return rows.map((r) => {
    const l = local.get(r.plugin_id);
    const m = r.manifest ?? {};
    return {
      id: r.plugin_id,
      name: l?.name ?? m.name ?? m.label ?? r.plugin_id,
      version: r.version ?? m.version ?? l?.version ?? '0.0.0',
      class: (r.class as PluginManifest['class']) ?? l?.class ?? 'C',
      description: l?.description ?? m.description ?? '',
      icon: l?.icon ?? 'Database',
      kernel: l?.kernel ?? '>=1.0.0 <2.0.0',
      permissions: (r.permissions ?? m.permissions ?? l?.permissions ?? []) as PluginManifest['permissions'],
      slots: (m.slots ?? l?.slots ?? ['settings']) as PluginManifest['slots'],
      dependsOn: m.dependsOn ?? l?.dependsOn,
      defaultEnabled: l?.defaultEnabled ?? false,
    } satisfies PluginManifest;
  });
}

const Ctx = createContext<KernelCtx | null>(null);

export function KernelProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState<Set<string>>(loadEnabled);
  const [configured, setConfigured] = useState<Record<string, boolean>>({});
  const [available, setAvailable] = useState<Record<string, boolean>>({});
  const [requiredPlan, setRequiredPlan] = useState<Record<string, string | null>>({});
  const [registry, setRegistry] = useState<PluginManifest[]>(FIRST_PARTY_PLUGINS);

  useEffect(() => {
  }, []);

  // docs/11 §8: when running against the live API, the server plugin table is
  // the truth of record — the kernel re-syncs enablement from it on load, so an
  // owner toggling in another tab (or a drain) is honored on next mount.
  useEffect(() => {
    /* plugins always sync from the server registry (single brain) */
    let cancelled = false;
    (async () => {
      try {
        /* unit 14 fix: the provider mounts before AuthGate resolves, so the token
           often does not exist yet on a fresh browser — wait (bounded) for login
           instead of no-oping until the next reload. Mirrors the dataset loader's
           bounded wait. */
        /* FEX-3: wait (bounded) for THIS session's in-memory bearer — set by login or the /auth/renew
           exchange — instead of for a value persisted in localStorage. */
        for (let i = 0; i < 40 && !getToken(); i++) {
          await new Promise(r => setTimeout(r, 250));
        }
        if (!getToken()) return;
        // Same-origin deploy contract (orchestrator verdict, 2026-09-06): the
        // relative fetch is intentional — API serves the app / VITE_API_BASE is
        // pinned at build. Split-origin serving is a hardening-backlog item.
        const res = await fetch(`${LIVE_BASE}/plugins`, { credentials: 'same-origin', headers: { ...authHeaders() } });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const rows: ServerPluginRow[] = Array.isArray(data.plugins) ? data.plugins : [];
        if (!rows.length || cancelled) return;
        const live = new Set(rows.filter(r => r.enabled).map(r => r.plugin_id));
        /* KERNEL-1: the board and `all` come from the server registry, so a plugin
           the client has no local copy of is still visible and still switchable. */
        setRegistry(manifestsFromServer(rows));
        // configured = server's flag (non-privileged rows) or settings-key presence
        // (privileged rows get raw settings; we count keys, never surface values)
        setConfigured(Object.fromEntries(rows.map(r => [
          r.plugin_id,
          r.configured === true || (r.settings != null && typeof r.settings === 'object' && Object.keys(r.settings as object).length > 0),
        ])));
        setAvailable(Object.fromEntries(rows.map(r => [r.plugin_id, r.available !== false])));
        setRequiredPlan(Object.fromEntries(rows.map(r => [r.plugin_id, r.requiredPlan ?? null])));
        setEnabled(prev => {
          /* KERNEL-1: do NOT intersect with the local registry — a server-enabled
             plugin must stay enabled in the client even when FIRST_PARTY_PLUGINS
             has never heard of it (that filter silently hid teacher.classroom,
             exams.assessment, student.world and 9 more). */
          const next = new Set<string>([...prev].filter(id => live.has(id)));
          for (const id of live) next.add(id);
          localStorage.setItem(LS_KEY, JSON.stringify([...next]));
          return next;
        });
      } catch { /* offline or mock — localStorage mirror stays authoritative */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const value = useMemo<KernelCtx>(() => ({
    enabled,
    configured,
    available,
    requiredPlan,
    isEnabled: id => enabled.has(id),
    enable: id => setEnabled(prev => {
      const next = new Set(prev); next.add(id);
      localStorage.setItem(LS_KEY, JSON.stringify([...next]));
      return next;
    }),
    disable: id => setEnabled(prev => {
      const next = new Set(prev); next.delete(id);
      localStorage.setItem(LS_KEY, JSON.stringify([...next]));
      return next;
    }),
    manifestFor: id => registry.find(p => p.id === id) ?? FIRST_PARTY_PLUGINS.find(p => p.id === id),
    all: registry,
  }), [enabled, configured, available, requiredPlan, registry]);

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
  const { isEnabled, manifestFor, enable } = useKernel();
  const session = useSession();
  const m = manifestFor(plugin);
  const [turning, setTurning] = useState(false);
  /* The owner (or IT admin) can turn a module on from right here — 'ask the
     school owner' must never dead-end the person who IS the owner. */
  const canTurnOn = session.role === 'owner' || session.role === 'itadmin';
  const turnOn = async () => {
    if (!m) return;
    setTurning(true);
    try {
      if (LIVE_API) await apiEnablePlugin(m.id, m.version, m.class, m.permissions);
      enable(m.id);
    } catch { /* the Modules page shows the server's reason; local flip below still applies */ enable(m.id); }
    setTurning(false);
  };
  if (isEnabled(plugin)) return <>{children}</>;
  return (
    <div style={{ maxWidth: 640, margin: '0 auto', paddingTop: 'var(--s-8)' }}>
      <Empty
        titleAs="h1"
        icon={<Icon.Database size={22} />}
        title={`This feature is switched off`}
        sub={`${m?.name ?? plugin} is optional. Nothing is lost while it is off — your data is saved, and it will come back when it is switched on.`}
        action={
          <div className="u-flex" style={{ gap: 10, flexWrap: 'wrap' }}>
            {canTurnOn && m && <button className="btn btn-primary" disabled={turning} onClick={turnOn}>{turning ? 'Turning on…' : `Turn on ${m.name}`}</button>}
            <Link to="/plugins" className="btn btn-ghost">Open Add-ons</Link>
          </div>
        }
      />
    </div>
  );
}

export { KERNEL_VERSION };
