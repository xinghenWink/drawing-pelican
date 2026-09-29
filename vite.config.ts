import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
export default defineConfig({
  base: './',
  plugins: [react()],
  // 公式引擎随回复面板按需加载，并与 Markdown 分块，避免初始工作台承担渲染依赖。
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.replace(/\\/g, '/').includes('/node_modules/katex/')) return 'math-renderer'
        },
      },
    },
  },
  test: { include: ['src/**/*.test.ts'] },
})
