/**
 * Jest configuration for the RYNEX Vehicles API contract tests.
 *
 * - preset 'ts-jest'  : TypeScript compilation on the fly.
 * - roots <tests>     : only the contract-test suite is executed.
 * - setupFiles        : tests/setup.ts runs BEFORE any test module is loaded,
 *                       so process.env.SECRETKEY is guaranteed to exist before
 *                       src/server.ts (and its JWT middleware) is imported.
 * - transform override: the repo tsconfig.json sets rootDir=./src and excludes
 *                       tests, so we pass an inline compilerOptions object to
 *                       ts-jest instead of pointing at that file.
 *
 * NO DATABASE IS REQUIRED: every tested route fails fast in validation or
 * auth middleware before any db.exec call (verified against src sources).
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testTimeout: 15000,
  verbose: true,
  setupFiles: ['<rootDir>/tests/setup.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          target: 'es2016',
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          forceConsistentCasingInFileNames: true,
          strict: true,
          skipLibCheck: true,
          resolveJsonModule: true
        }
      }
    ]
  }
};
