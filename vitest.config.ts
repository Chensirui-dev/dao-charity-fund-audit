import { defineConfig } from 'vitest/config';

/**
 * 前端单元测试配置。
 *
 * 只收 src 下的 .test.ts：chain/test/contracts.test.js 是合约测试，
 * 那套用自建的中文输出框架跑在 ganache 上，混进来会被 vitest 当成空测试文件报错。
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'chain/**'],
    environment: 'node',
    // 运行环境禁止写入系统临时目录，关掉依赖缓存避免报 EPERM
    deps: { cache: false },
    pool: 'forks',
  },
});
