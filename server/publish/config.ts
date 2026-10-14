// Server-only settings for the publish path, read from the environment at request time
// (`.env` locally, project settings on Vercel). The names match contentful/seed.mjs, so one
// `.env` serves both. Nothing here is exposed to the browser.

export interface PublishConfig {
  contentful: { space: string, environment: string, locale: string, accessToken: string, webhookSecret: string }
  supabase: { url: string, secretKey: string }
  /** The public site, for the canary. Unset until the site has a /__canary route. */
  siteUrl: string | null
  /** Identifies this deployment in the lease and the build log. */
  holder: string
}

export class ConfigError extends Error {
  override name = 'ConfigError'
}

export function publishConfig(env: Record<string, string | undefined> = process.env): PublishConfig {
  const missing: string[] = []
  const need = (name: string) => {
    const value = env[name]
    if (!value) missing.push(name)
    return value ?? ''
  }
  const config: PublishConfig = {
    contentful: {
      space: need('CONTENTFUL_SPACE_ID'),
      environment: env.CONTENTFUL_ENVIRONMENT || 'master',
      locale: env.CONTENTFUL_LOCALE || 'en-US',
      accessToken: need('CONTENTFUL_DELIVERY_TOKEN'),
      webhookSecret: need('CONTENTFUL_WEBHOOK_SECRET'),
    },
    supabase: { url: need('SUPABASE_URL'), secretKey: need('SUPABASE_SECRET_KEY') },
    siteUrl: env.SITE_URL || null,
    holder: env.VERCEL_DEPLOYMENT_ID || env.VERCEL_URL || 'local',
  }
  need('BLOB_READ_WRITE_TOKEN')
  if (missing.length) throw new ConfigError(`Publishing is not configured; missing ${missing.join(', ')}`)
  return config
}
