/* Leaf module — must stay import-free so cross-chunk init order can never
   shadow it (the shared-components chunk initializes before the main bundle). */
import type { WOStatus } from '../types/domain';

export const WO_FLOW: readonly WOStatus[] = ['reported', 'assigned', 'accepted', 'en-route', 'on-site', 'repairing', 'verification', 'resolved'];
export type WOFlowStep = WOStatus;
