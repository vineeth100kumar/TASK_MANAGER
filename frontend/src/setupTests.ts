/*
 * @testing-library/jest-dom was already a dependency but nothing loaded it,
 * so matchers like toBeInTheDocument failed as "Invalid Chai property".
 */
import '@testing-library/jest-dom/vitest';

/* jsdom has no layout, so scrolling a row into view is a no-op here. */
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
