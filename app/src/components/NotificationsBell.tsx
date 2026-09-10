/* ============================================================
   NotificationsBell — the chrome bell, fed by the real doors.
   T405: GET /notifications supplies the list; the unread badge is
   the server's count; clicking an item calls POST
   /notifications/read and reconciles with a refetch. Items
   addressed to the whole school (user_id NULL) cannot be cleared
   by this door yet — the footer says so instead of pretending.
   Self-contained so Shell (L5) can mount it as a drop-in swap.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../services/liveApi';
import { friendly } from '../lib/friendlyErrors';
import { Badge, Dropdown, useToast } from './ui';
import { Icon } from './Icon';
import { fmtRelative } from '../lib/format';

interface ServerNotification {
  id: string;
  user_id: string | null;
  group: string;
  title: string;
  body: string | null;
  ref: string | null;
  read_at: string | null;
  created_at: string;
}

interface NotificationItem {
  id: string;
  mine: boolean;
  group: string;
  title: string;
  body: string;
  ref: string | null;
  read: boolean;
  on: Date;
}

const GROUP_TONE: Record<string, 'danger' | 'warning' | 'accent' | 'neutral'> = {
  'needs-you': 'danger',
  approvals: 'warning',
  updates: 'accent',
};

export function NotificationsBell() {
  const navigate = useNavigate();
  const toast = useToast();
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await apiGet<{ notifications: ServerNotification[] }>('/notifications');
      setItems((res.notifications ?? []).map(n => ({
        id: n.id, mine: n.user_id != null, group: n.group ?? 'updates',
        title: n.title, body: n.body ?? '', ref: n.ref ?? null,
        read: n.read_at != null, on: new Date(n.created_at),
      })));
      setError(null);
    } catch (e) {
      setError(friendly(e));
    }
  };

  useEffect(() => { load(); }, []);
  /* gentle refresh while the bell is mounted — the door is auth-only and cheap */
  useEffect(() => {
    const t = setInterval(() => { load(); }, 45000);
    return () => clearInterval(t);
  }, []);

  const unread = useMemo(() => (items ?? []).filter(n => !n.read).length, [items]);

  const markRead = async (n: NotificationItem) => {
    if (n.read) { if (n.ref) navigate(n.ref); return; }
    setMarking(n.id);
    try {
      await apiPost('/notifications/read', { id: n.id });
      await load(); /* badge and list always re-derive from the server */
      if (n.ref) navigate(n.ref);
    } catch (e) {
      toast({ title: 'Could not mark as read', sub: friendly(e), tone: 'error' });
    } finally {
      setMarking(null);
    }
  };

  return (
    <Dropdown width={350} label="Notifications" trigger={() => (
      <button className="iconbtn" aria-label={`Notifications, ${unread} unread`}>
        <Icon.Bell size={16} />
        {!!unread && <span style={{ position: 'absolute', top: 4, right: 4, width: 8, height: 8, borderRadius: 5, background: 'var(--danger)', border: '2px solid var(--surface)' }} />}
      </button>
    )}>
      {close => (
        <>
          <div className="u-between" style={{ padding: '8px 10px 6px' }}>
            <div role="none" className="dropdown-label" style={{ padding: 0 }}>Notifications</div>
            <button className="u-xs u-muted" onClick={() => { load(); }}>Refresh</button>
          </div>
          {error && (
            <div style={{ padding: '10px 12px' }}>
              <div className="u-small" style={{ color: 'var(--danger)' }}>Couldn't load notifications</div>
              <div className="u-xs u-muted" style={{ marginTop: 2 }}>{error}</div>
              <button className="u-xs u-accent" style={{ marginTop: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} onClick={() => load()}>Try again</button>
            </div>
          )}
          {!error && items === null && (
            <div className="u-small u-faint" style={{ padding: '10px 12px' }}>Loading…</div>
          )}
          {!error && items !== null && items.length === 0 && (
            <div style={{ padding: '14px 12px' }}>
              <div className="u-small" style={{ fontWeight: 600 }}>You're all caught up</div>
              <div className="u-xs u-muted" style={{ marginTop: 2 }}>Nothing needs you right now. School updates will land here.</div>
            </div>
          )}
          {!error && items !== null && items.slice(0, 7).map(n => (
            <button
              key={n.id}
              role="menuitem"
              className="dropdown-item"
              style={{ alignItems: 'flex-start', gap: 10, opacity: marking === n.id ? 0.6 : 1 }}
              onClick={() => { markRead(n); close(); }}
            >
              <span style={{ marginTop: 5, width: 7, height: 7, borderRadius: 4, background: n.read ? 'var(--border-strong)' : (GROUP_TONE[n.group] === 'danger' ? 'var(--danger)' : GROUP_TONE[n.group] === 'warning' ? 'var(--warning)' : 'var(--accent)'), flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: n.read ? 480 : 600, fontSize: 'var(--text-md)' }}>{n.title}</span>
                {n.body && <span className="u-small u-muted" style={{ display: 'block', marginTop: 1 }}>{n.body}</span>}
                <span className="u-xs u-faint" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {fmtRelative(n.on)} · {n.group === 'needs-you' ? 'Needs you' : n.group === 'approvals' ? 'Approvals' : n.group}
                  {!n.mine && <Badge tone="outline">school-wide</Badge>}
                </span>
              </span>
            </button>
          ))}
          {!error && items !== null && items.length > 0 && (
            <div className="u-xs u-faint" style={{ padding: '6px 12px 10px' }}>
              Showing the latest {Math.min(7, items.length)} of {items.length}. School-wide announcements stay unread until the server clears them — items addressed to you clear on click.
            </div>
          )}
        </>
      )}
    </Dropdown>
  );
}
