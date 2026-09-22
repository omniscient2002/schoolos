/* ============================================================
   teacherContext.tsx — TU-1 class context ("context everywhere",
   plan §0.2). One provider mounted once (App.tsx) that carries:

   • which class/subject/period the teacher is currently working
     with — the NOW card publishes this, NEXT rows publish on tap;
   • openAction(actionId, ctx?) — deep-links into a TU-2 flow
     screen with prefill params, so quick actions opened from a
     class context prefill class · subject · teacher and the
     teacher fills only what is necessary (plan §P1).

   The provider also mounts the floating QuickActions button for
   teacher sessions, so the same menu is available from every
   teacher screen without each screen importing it.
   ============================================================ */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from './store';
import { useSession } from '../App';
import { canSurface } from '../lib/effective';
import { QuickActions } from '../components/teacher/QuickActions';

export interface TeacherClassContext {
  classGrade?: string;   // "8-B"
  subject?: string;
  room?: string;
  period?: number;
  sectionId?: string;
  teacher?: string;
}

export interface QuickActionPrefill extends TeacherClassContext {
  actionId?: string;
  kind?: string;         // e.g. "incident" for concerns, "substitute" for leave
}

interface TeacherCtx {
  classContext: TeacherClassContext | null;
  setClassContext: (c: TeacherClassContext | null) => void;
  /** Deep-link to a TU-2 flow route, carrying the prefill in route state. */
  openAction: (to: string, prefill?: QuickActionPrefill) => void;
}

const Ctx = createContext<TeacherCtx | null>(null);

export function TeacherProvider({ children }: { children: ReactNode }) {
  const [classContext, setClassContext] = useState<TeacherClassContext | null>(null);
  const navigate = useNavigate();
  const { session } = useStore();
  const live = useSession();
  // RBAC-1: prefer the server's capability answer, so a mask-granted custom role that can
  // reach the teacher lane still gets the quick-actions menu. Fall back to the built-in
  // role only when the server has not spoken (demo preview / no payload).
  const caps = live.effective?.capabilities;
  const isTeacher = caps ? canSurface(live.effective, '/teacher/homework') : session.roleId === 'teacher';

  const openAction = useCallback((to: string, prefill?: QuickActionPrefill) => {
    navigate(to, prefill ? { state: { prefill } } : undefined);
  }, [navigate]);

  const value = useMemo(() => ({ classContext, setClassContext, openAction }), [classContext, openAction]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* one floating menu, every teacher screen — §P1 */}
      {isTeacher && <QuickActions />}
    </Ctx.Provider>
  );
}

export function useTeacher(): TeacherCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTeacher outside TeacherProvider');
  return v;
}
