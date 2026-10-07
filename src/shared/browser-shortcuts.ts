export type BrowserShortcut = 'browser-close-tab' | 'browser-new-tab' | 'browser-reload' | 'browser-address'

export function matchBrowserShortcut(key: string, meta: boolean, shift: boolean): BrowserShortcut | null {
  if (!meta || shift) return null
  switch (key.toLowerCase()) {
    case 'w': return 'browser-close-tab'
    case 't': return 'browser-new-tab'
    case 'r': return 'browser-reload'
    case 'l': return 'browser-address'
    default: return null
  }
}

export function browserLoadError(error: string): string {
  if (error.includes('ERR_UNSAFE_PORT')) return 'This port is blocked by the browser. Use a different port.'
  if (error.includes('ERR_CONNECTION_REFUSED')) return 'Could not connect. Check that the server is running and the port is correct.'
  if (error.includes('ERR_NAME_NOT_RESOLVED')) return 'Could not find this website. Check the address and your connection.'
  if (error.includes('ERR_INTERNET_DISCONNECTED')) return 'You are offline. Check your internet connection and try again.'
  if (error.includes('ERR_CERT_')) return 'The website’s security certificate could not be verified.'
  if (error.includes('ERR_TIMED_OUT') || error.includes('ERR_CONNECTION_TIMED_OUT')) return 'The website took too long to respond. Try again.'
  return error.startsWith('ERR_') ? `Could not load this page (${error}).` : error
}
