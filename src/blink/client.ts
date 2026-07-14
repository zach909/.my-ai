import { createClient } from '@blinkdotnew/sdk'

export const blink = createClient({
  projectId: import.meta.env.VITE_BLINK_PROJECT_ID || 'prometheus-elastic-core-o3sqgyd1',
  publishableKey: import.meta.env.VITE_BLINK_PUBLISHABLE_KEY || 'blnk_pk_sZJ5CVZpD02Sv9YMbnubIm9acophoY55',
  authRequired: false,
  auth: { mode: 'managed' },
})
