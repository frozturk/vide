import type { VideApi } from '../../shared/types'

declare global {
  interface Window {
    vide: VideApi
  }
}

export {}
