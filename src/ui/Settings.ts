/** Player settings, saved in the browser between sessions. */
export type QualityLevel = 'auto' | 'low' | 'medium' | 'high'
export type CameraDistance = 'near' | 'normal' | 'far'

export interface Settings {
  quality: QualityLevel
  /** Master volume 0–1 */
  volume: number
  motionBlur: boolean
  camera: CameraDistance
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'auto',
  volume: 0.8,
  motionBlur: true,
  camera: 'normal',
}

const KEY = 'horizon-drive-settings'

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const s = JSON.parse(raw) as Partial<Settings>
    return {
      quality: (['auto', 'low', 'medium', 'high'] as const).includes(s.quality as QualityLevel) ? s.quality! : DEFAULT_SETTINGS.quality,
      volume: typeof s.volume === 'number' ? Math.min(1, Math.max(0, s.volume)) : DEFAULT_SETTINGS.volume,
      motionBlur: typeof s.motionBlur === 'boolean' ? s.motionBlur : DEFAULT_SETTINGS.motionBlur,
      camera: (['near', 'normal', 'far'] as const).includes(s.camera as CameraDistance) ? s.camera! : DEFAULT_SETTINGS.camera,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* storage blocked */ }
}
