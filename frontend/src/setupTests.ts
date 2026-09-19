/*
 * @testing-library/jest-dom was already a dependency but nothing loaded it,
 * so matchers like toBeInTheDocument failed as "Invalid Chai property".
 */
import '@testing-library/jest-dom/vitest';
