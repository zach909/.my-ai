import { createClient } from '@blinkdotnew/sdk'

export const blink = createClient({
  projectId: import.meta.env.VITE_BLINK_PROJECT_ID || 'asi-architect-platform-75ii5kgl',
  publishableKey: import.meta.env.VITE_BLINK_PUBLISHABLE_KEY || 'blnk_pk_GFf4pKWaEqyeZCLZNtiMvX0J2EYmPnVT',
  authRequired: false,
  auth: { mode: 'managed' },
})
