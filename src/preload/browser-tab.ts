import { contextBridge } from 'electron'

contextBridge.executeInMainWorld({
  func: (major: string, full: string) => {
    const ua = (globalThis as any).NavigatorUAData?.prototype
    if (!ua) return
    const brands = (version: string, grease: string): { brand: string; version: string }[] => [{ brand: 'Google Chrome', version }, { brand: 'Chromium', version }, { brand: 'Not;A=Brand', version: grease }]
    const high = ua.getHighEntropyValues
    const json = ua.toJSON
    Object.defineProperty(ua, 'brands', { get: () => brands(major, '8'), configurable: true, enumerable: true })
    ua.getHighEntropyValues = function (hints: string[]) {
      return high.call(this, hints).then((values: Record<string, unknown>) => ({ ...values, brands: brands(major, '8'), ...(values.fullVersionList ? { fullVersionList: brands(full, '8.0.0.0') } : {}) }))
    }
    ua.toJSON = function () { return { ...json.call(this), brands: brands(major, '8') } }
  },
  args: [process.versions.chrome.split('.')[0], process.versions.chrome]
})
