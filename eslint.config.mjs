// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  {
    // The engine runs in the browser, on the server and in a Web Worker, and must stay
    // framework- and vendor-free (ARCHITECTURE.md §6.7). Only relative imports are allowed.
    files: ['shared/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          regex: '^(?!\\.{1,2}/)',
          message: 'shared/engine may only import its own modules (relative paths). No Vue, Nitro, Contentful, Supabase or other packages.',
        }],
      }],
    },
  },
)
