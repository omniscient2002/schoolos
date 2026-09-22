/* ============================================================
   ChildFlows — the per-child hub that switches between the flow
   screens (PU-2). The orchestrator routes this with one child's id,
   name and the family's linked children.
   ============================================================ */
import { useState } from 'react';
import { PageHead, Tabs } from '../../../components/ui';
import Attendance from './Attendance';
import Assignments from './Assignments';
import Exams from './Exams';
import Timeline from './Timeline';
import Ptm from './Ptm';
import Explain from './Explain';
import Transport from './Transport';
import Documents from './Documents';
import type { FlowChild } from './helpers';

const TABS = [
  { id: 'attendance', label: 'Attendance' },
  { id: 'assignments', label: 'Homework' },
  { id: 'exams', label: 'Exams' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'documents', label: 'Documents' },
  { id: 'ptm', label: 'Meetings' },
  { id: 'transport', label: 'Transport' },
  { id: 'explain', label: 'Explain' },
];

export default function ChildFlows({ childId, childName, children }: {
  childId: string; childName: string; children: FlowChild[];
}) {
  const [tab, setTab] = useState('attendance');

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', display: 'grid', gap: 16 }}>
      <PageHead title={childName} sub="Attendance, homework, exams, results and meetings — for this child." />
      <Tabs tabs={TABS} active={tab} onChange={setTab} panelId="child-flows" />
      <div role="tabpanel" id={`child-flows-panel-${tab}`} aria-labelledby={`child-flows-tab-${tab}`}>
        {tab === 'attendance' && <Attendance childId={childId} />}
        {tab === 'assignments' && <Assignments childId={childId} />}
        {tab === 'exams' && <Exams childId={childId} />}
        {tab === 'timeline' && <Timeline childId={childId} />}
        {tab === 'documents' && <Documents childId={childId} />}
        {tab === 'ptm' && <Ptm children={children} />}
        {tab === 'transport' && <Transport childId={childId} />}
        {tab === 'explain' && <Explain />}
      </div>
    </div>
  );
}
