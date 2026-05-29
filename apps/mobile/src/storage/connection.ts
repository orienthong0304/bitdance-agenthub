import type { ConnectionConfig } from '../types'

const STORAGE_KEY = 'agenthub.mobile.connection'

const EMPTY_CONNECTION: ConnectionConfig = {
  baseUrl: '',
  deviceToken: '',
}

export function loadConnection(): ConnectionConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY_CONNECTION
    const parsed = JSON.parse(raw) as Partial<ConnectionConfig>
    return {
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : '',
      deviceToken: typeof parsed.deviceToken === 'string' ? parsed.deviceToken : '',
    }
  } catch {
    return EMPTY_CONNECTION
  }
}

export function saveConnection(config: ConnectionConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}
