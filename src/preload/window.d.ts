import { ElectronAPI } from '@electron-toolkit/preload'
import type { SwitchyardApi } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    api: SwitchyardApi
  }
}
