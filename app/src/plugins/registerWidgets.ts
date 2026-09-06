/* Widget registration — loaded once by the shell so plugin
   widgets exist regardless of which route is active. */
import { registerWidget } from './Slot';
import LibraryOverdue from './widgets/LibraryOverdue';
import GpsDelayApprovals from './widgets/GpsDelayApprovals';
import SubstitutionFeed from './widgets/SubstitutionFeed';

registerWidget('library', 'library.overdue', LibraryOverdue);
registerWidget('transport.gps', 'gps.delay.approvals', GpsDelayApprovals);
registerWidget('ops.timetable', 'timetable.substitutions', SubstitutionFeed);
