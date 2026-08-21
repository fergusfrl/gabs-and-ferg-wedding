// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  // Netlify sets `URL` at build time to the site's canonical URL (custom domain
  // once configured, otherwise the netlify.app subdomain) — fall back to the
  // intended custom domain for local builds where that env var isn't set.
  site: process.env.URL || 'https://www.gabsandferg.com',
  integrations: [react()],
  build: {
    inlineStylesheets: 'always'
  }
});