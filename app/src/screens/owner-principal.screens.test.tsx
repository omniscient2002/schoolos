// OPP-TEST-5 · behavioural tests for the owner/principal oversight product screens. Before this file
// the only owner/principal screen test was a crash-safety case for Group; BoardPack, PrincipalBrief,
// Announcements, Compliance, Certificates and Delegations had none. Each is rendered against mocked
// live doors and must show its real heading (and, for the board pack, a live figure) rather than throw.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  api: {
    apiBoardPack: vi.fn(),
    apiBoardPackSnapshot: vi.fn(),
    apiPrincipalBrief: vi.fn(),
    apiAnnouncements: vi.fn(),
    apiCreateAnnouncement: vi.fn(),
    apiApproveAnnouncement: vi.fn(),
    apiCompliance: vi.fn(),
    apiCreateCompliance: vi.fn(),
    apiFileCompliance: vi.fn(),
    apiCertificates: vi.fn(),
    apiRequestCertificate: vi.fn(),
    apiSignCertificate: vi.fn(),
    apiStudents: vi.fn(),
    apiGet: vi.fn(),
    apiPost: vi.fn(),
  },
}));

vi.mock('../services/liveApi', () => h.api);
vi.mock('../App', () => ({ useSession: () => ({ name: 'Dr. Meera Krishnan', role: 'principal', email: 'principal@meridian.edu' }) }));

import BoardPack from './BoardPack';
import PrincipalBrief from './PrincipalBrief';
import Announcements from './Announcements';
import Compliance from './Compliance';
import Certificates from './Certificates';
import Delegations from './Delegations';

beforeEach(() => {
  vi.clearAllMocks();
  h.api.apiBoardPack.mockResolvedValue({
    students: 412, staff_count: 48,
    attendance_today: { present: 380, absent: 12, marked: 392 },
    fees: { billed: 1000000, collected: 700000, outstanding: 300000, open_obligations: 21 },
    cases: { open: 3, total: 9 }, admissions_open_leads: 17, safety_open: 1,
    as_of: new Date().toISOString(),
  });
  h.api.apiBoardPackSnapshot.mockResolvedValue({ content_hash: 'abc123' });
  h.api.apiPrincipalBrief.mockResolvedValue({ brief: null, brief_date: null });
  h.api.apiAnnouncements.mockResolvedValue({ announcements: [] });
  h.api.apiCompliance.mockResolvedValue({ items: [] });
  h.api.apiCertificates.mockResolvedValue({ certificates: [] });
  h.api.apiStudents.mockResolvedValue({ students: [] });
  h.api.apiGet.mockImplementation((url: string) => {
    if (url === '/delegations') return Promise.resolve({ delegations: [] });
    if (url === '/delegations/roster') return Promise.resolve({ users: [] });
    return Promise.resolve({});
  });
});

describe('OPP-TEST-5 · owner/principal oversight screens render', () => {
  it('BoardPack shows the live cross-domain roll-up', async () => {
    render(<BoardPack />);
    expect(await screen.findByText('Board pack')).toBeInTheDocument();
    expect(await screen.findByText('Active students')).toBeInTheDocument();
    expect(await screen.findByText('412')).toBeInTheDocument();
  });

  it('PrincipalBrief renders the morning brief surface', async () => {
    render(<PrincipalBrief />);
    expect(await screen.findByText('Morning brief')).toBeInTheDocument();
  });

  it('Announcements renders the composer', async () => {
    render(<Announcements />);
    expect(await screen.findByText('Announcements')).toBeInTheDocument();
    expect(await screen.findByText('New announcement')).toBeInTheDocument();
  });

  it('Compliance renders the calendar', async () => {
    render(<Compliance />);
    expect(await screen.findByText('Compliance calendar')).toBeInTheDocument();
  });

  it('Certificates renders the signing surface', async () => {
    render(<Certificates />);
    expect((await screen.findAllByText('Certificates')).length).toBeGreaterThan(0);
    expect(await screen.findByText('Request a certificate')).toBeInTheDocument();
  });

  it('Delegations renders and loads the deputy roster from its own door', async () => {
    render(<Delegations />);
    expect(await screen.findByText('Approval delegations')).toBeInTheDocument();
    expect(h.api.apiGet).toHaveBeenCalledWith('/delegations/roster');
  });
});
