/* Support — the teacher's student-support desk: concerns, doubts, interventions,
   parent meetings and the safety box, in one place (PRD-1). */
import { useState } from 'react';
import { PageHead, Tabs } from '../../components/ui';
import { roleLabel } from '../../lib/labels';
import { useStore } from '../../state/store';
import { DeniedState, useTeacherAccess } from './teacherKit';
import Concerns from './Concerns';
import Doubts from './Doubts';
import Interventions from './Interventions';
import Ptm from './Ptm';
import SafetyBox from './SafetyBox';

const TABS = [
  { id: 'concerns', label: 'Concerns' },
  { id: 'doubts', label: 'Doubts' },
  { id: 'interventions', label: 'Interventions' },
  { id: 'ptm', label: 'Parent meetings' },
  { id: 'safety', label: 'Safety box' },
];

export default function Support() {
  const { session } = useStore();
  const allowed = useTeacherAccess('/teacher/homework');
  const [tab, setTab] = useState('concerns');
  if (!allowed) return <DeniedState role={roleLabel(session.roleId)} />;
  return (
    <div>
      <PageHead title="Student support" sub="Flag a concern, answer a question, plan support, meet a parent — all recorded, all private where it should be." />
      <Tabs tabs={TABS} active={tab} onChange={setTab} pill />
      <div style={{ height: 16 }} />
      {tab === 'concerns' && <Concerns />}
      {tab === 'doubts' && <Doubts />}
      {tab === 'interventions' && <Interventions />}
      {tab === 'ptm' && <Ptm />}
      {tab === 'safety' && <SafetyBox />}
    </div>
  );
}
