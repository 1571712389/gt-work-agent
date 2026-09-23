import type { GtApi } from '@shared/api'

declare global {
  interface Window {
    gt: GtApi
  }
}

export {}
