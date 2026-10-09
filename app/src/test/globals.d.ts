/* Type-only bootstrap for the test project.
 *
 * The app project deliberately excludes src/test, so the custom matchers that
 * @testing-library/jest-dom registers for vitest (toBeInTheDocument,
 * toHaveTextContent, …) are not in scope for the compiler by default. This
 * pulls them in for tests only — it cannot leak into the browser build. */
import '@testing-library/jest-dom/vitest';
