const path = require('path');

// Node 20.6+ supports loading a .env file natively. Best-effort: tests
// should still run (against whatever is already in process.env) if no
// local .env file exists, e.g. in a CI environment that injects env vars
// directly.
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  // no .env file present — rely on already-exported env vars.
}

/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleFileExtensions: ['js', 'json', 'ts'],
  testEnvironment: 'node',
  collectCoverageFrom: ['src/**/*.(t|j)s'],
};
