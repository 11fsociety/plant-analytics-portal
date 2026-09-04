import adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      runtime: 'nodejs20.x',
      maxDuration: 60,
      memory: 3009,
    }),
    alias: {
      $lib: 'src/lib',
    },
    csrf: { trustedOrigins: [] },
  },
};

export default config;
