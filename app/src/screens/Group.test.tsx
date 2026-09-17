// FEX-1 — the /group console crashed the whole app for a real tenant.
//
// `CAMPUS_METRICS` only knows the demo's `north/city/east`; a real tenant's campuses are `main`/`campus-N`,
// so `CAMPUS_METRICS[c.id].attendance` threw on `undefined`, and the root ErrorBoundary wraps the router —
// the sidebar and every screen died with it. This test renders the screen with an unknown campus id and
// asserts it renders honestly ("—") instead of throwing.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../data/dataset', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/dataset')>();
  return {
    ...actual,
    campuses: [{ id: 'main', name: 'Main Campus', short: 'Main', city: 'Pune', students: 120, capacity: 200, hue: 20 }],
  };
});

import Group from './Group';
import { StoreProvider } from '../state/store';

describe('FEX-1 · Group console is safe for a real-tenant campus id', () => {
  it('renders without throwing and shows an honest dash for the missing metric', () => {
    render(
      <StoreProvider>
        <Group />
      </StoreProvider>,
    );
    expect(screen.getByText('Group console')).toBeInTheDocument();
    // the attendance/collection cells fall back to an em dash rather than a fabricated number
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
