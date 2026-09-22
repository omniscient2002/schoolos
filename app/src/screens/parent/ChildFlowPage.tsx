/* Per-child flow page — resolves the child from /parent/home and renders the
   flow hub (attendance+leave, exams, assignments, timeline, explain, PTM). */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Empty, PageHead, SkeletonCard } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { getParentHome } from '../../services/parentApi';
import ChildFlows from './flows/ChildFlows';

interface Child { child_id: string; name: string }

export default function ChildFlowPage() {
  const { id } = useParams<{ id: string }>();
  const [children, setChildren] = useState<Child[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getParentHome()
      .then(d => { if (live) setChildren(d.children.map(c => ({ child_id: c.child_id, name: c.name }))); })
      .catch(e => { if (live) setError(String(e).replace('Error: ', '')); });
    return () => { live = false; };
  }, []);

  if (error) return <PageHead title="Family" sub={error} />;
  if (!children) return <SkeletonCard lines={6} />;
  const child = children.find(c => c.child_id === id) ?? children[0];
  if (!child) return <Empty icon={<Icon.Users size={22} />} title="No linked children" sub="Ask the school office to link your account to your child." />;

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <ChildFlows childId={child.child_id} childName={child.name} children={children} />
    </div>
  );
}
