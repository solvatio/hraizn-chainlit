import path from 'node:path';

// Unit tests next to the sources (src/**/*.test.ts). Run with `pnpm vitest run`.
export default {
  resolve: { alias: { src: path.resolve(__dirname, 'src') } },
  test: { include: ['src/**/*.test.ts'] }
};
