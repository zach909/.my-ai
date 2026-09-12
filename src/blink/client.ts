import { createClient } from '@blinkdotnew/sdk'

export const blink = createClient({
  projectId: import.meta.env.VITE_BLINK_PROJECT_ID || 'quickbase-ui-ceaynyxg',
  publishableKey: import.meta.env.VITE_BLINK_PUBLISHABLE_KEY || 'blnk_pk_xE8ho7xrGjNgIGi1xpvF9Sn3it-Nx37L',
  authRequired: false,
  auth: { mode: 'managed' },
})
