// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  devtools: { enabled: true },
  modules: ['@nuxt/eslint'],
  experimental: {
    // Keep the payload inside the HTML so cached pages never ship a separate _payload.json
    // (see ARCHITECTURE.md §10.4 and CVE-2026-71316).
    payloadExtraction: false,
  },
})
