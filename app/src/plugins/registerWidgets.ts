/* Widget registration — loaded once by the shell so plugin
   widgets exist regardless of which route is active. */
import { registerWidget } from './Slot';
import LibraryOverdue from './widgets/LibraryOverdue';

registerWidget('library', 'library.overdue', LibraryOverdue);
