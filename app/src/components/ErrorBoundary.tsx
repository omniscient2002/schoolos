/* ============================================================
   ErrorBoundary — the root render-crash net (P0 audit fix 1).

   A white screen means the React tree unmounted and told nobody.
   This boundary wraps the whole router in App.tsx so ANY render
   crash (any screen, any provider below it) keeps the tree mounted
   and swaps in a calm full-page fallback instead:

   • getDerivedStateFromError captures the failure for the render;
   • componentDidCatch logs the error + component stack to the
     console (the honest observability surface for now);
   • the fallback offers "Back to home" (clears the boundary state
     and navigates to '/') — the boundary sits OUTSIDE the router,
     so it uses window.location, not useNavigate.

   Deliberately dependency-free: it must render even when the crash
   came from the store, the kernel or the router itself.
   ============================================================ */
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    /* Console is the logging sink: visible in devtools and any
       session capture, and it must never depend on the crashed
       tree's providers. */
    console.error('[SchoolOS] Render crash caught by ErrorBoundary:', error, info.componentStack);
  }

  /** Clear the failure and go to the calm home surface. A full
   *  navigation (not router navigate) also drops any poisoned
   *  in-memory state below this boundary. */
  backHome(): void {
    this.setState({ error: null });
    window.location.href = '/';
  }

  render(): ReactNode {
    const err = this.state.error;
    if (!err) return this.props.children;
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)', padding: 24 }}>
        <div className="u-col" style={{ gap: 14, alignItems: 'center', textAlign: 'center', maxWidth: 460 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--accent-weak)', display: 'grid', placeItems: 'center', color: 'var(--accent-text)' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
            </svg>
          </div>
          <div style={{ fontWeight: 650, letterSpacing: '-0.01em', fontSize: 'var(--text-lg, 17px)' }}>Something went wrong on this screen</div>
          <p style={{ color: 'var(--text-2)', fontSize: 'var(--text-sm)', margin: 0, lineHeight: 1.55 }}>
            Nothing was lost — your data is safe on the server. Going back to the home page is always safe; if the same screen crashes again, the school's IT desk can check the browser console for details.
          </p>
          <div className="u-flex" style={{ gap: 8, marginTop: 4 }}>
            <button className="btn btn-primary" onClick={() => this.backHome()}>Back to home</button>
            <button className="btn btn-secondary" onClick={() => window.location.reload()}>Reload</button>
          </div>
        </div>
      </div>
    );
  }
}
