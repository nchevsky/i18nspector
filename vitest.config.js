import base from 'bitumen/configuration/vitest';

/** @type {import('vitest/config').ViteUserConfig} */
export default {
  ...base,
  test: {
    ...base.test,
    coverage: {
      ...base.test.coverage,
      thresholds: {branches: 0, functions: 0, lines: 0, statements: 0} // TODO
    },
    passWithNoTests: true // TODO
  }
};
