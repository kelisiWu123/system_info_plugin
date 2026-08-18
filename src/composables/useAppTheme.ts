import { computed, ref } from 'vue'

const THEME_MIRROR_STORAGE_KEY = 'appThemePreferenceMirror'
const THEME_BROADCAST_CHANNEL = 'system-info-theme'

const preference = ref<AppThemePreference>('system')
const systemDark = ref(false)
const loading = ref(false)
const initialized = ref(false)

let mediaQuery: MediaQueryList | undefined
let broadcastChannel: BroadcastChannel | undefined
let initializePromise: Promise<void> | undefined

function normalizePreference(value: unknown): AppThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system'
}

function readMirroredPreference(): AppThemePreference {
  if (typeof localStorage === 'undefined') return 'system'

  try {
    return normalizePreference(localStorage.getItem(THEME_MIRROR_STORAGE_KEY))
  } catch {
    return 'system'
  }
}

function writeMirroredPreference(value: AppThemePreference) {
  if (typeof localStorage === 'undefined') return

  try {
    localStorage.setItem(THEME_MIRROR_STORAGE_KEY, value)
  } catch {
    // The service-backed setting remains the source of truth when localStorage is unavailable.
  }
}

const resolvedTheme = computed<AppResolvedTheme>(() => {
  if (preference.value === 'light' || preference.value === 'dark') return preference.value
  return systemDark.value ? 'dark' : 'light'
})

function applyThemeToDocument() {
  if (typeof document === 'undefined') return
  const theme = resolvedTheme.value
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}

function applyPreference(value: AppThemePreference, mirror = true) {
  preference.value = normalizePreference(value)
  if (mirror) writeMirroredPreference(preference.value)
  applyThemeToDocument()
}

function bindSystemTheme() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  if (mediaQuery) return

  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  systemDark.value = mediaQuery.matches
  mediaQuery.addEventListener('change', (event) => {
    systemDark.value = event.matches
    if (preference.value === 'system') applyThemeToDocument()
  })
}

function bindCrossWindowThemeSync() {
  if (typeof window === 'undefined') return

  window.addEventListener('storage', (event) => {
    if (event.key !== THEME_MIRROR_STORAGE_KEY) return
    applyPreference(normalizePreference(event.newValue), false)
  })

  if (typeof BroadcastChannel !== 'undefined' && !broadcastChannel) {
    broadcastChannel = new BroadcastChannel(THEME_BROADCAST_CHANNEL)
    broadcastChannel.addEventListener('message', (event) => {
      applyPreference(normalizePreference(event.data?.preference))
    })
  }
}

export async function initializeAppTheme() {
  if (initializePromise) return initializePromise

  initializePromise = (async () => {
    bindSystemTheme()
    applyPreference(readMirroredPreference(), false)
    bindCrossWindowThemeSync()

    loading.value = true
    try {
      if (typeof window.services?.getAppThemeSettings === 'function') {
        const settings = await window.services.getAppThemeSettings()
        applyPreference(normalizePreference(settings?.preference))
      }
    } catch (error) {
      console.warn('读取外观设置失败，使用本地或系统主题:', error)
    } finally {
      loading.value = false
      initialized.value = true
    }
  })()

  return initializePromise
}

export async function setAppThemePreference(nextPreference: AppThemePreference) {
  const next = normalizePreference(nextPreference)
  applyPreference(next)
  broadcastChannel?.postMessage({ preference: next })

  try {
    if (typeof window.services?.updateAppThemeSettings !== 'function') return

    const saved = await window.services.updateAppThemeSettings({ preference: next })
    const normalized = normalizePreference(saved?.preference)
    if (normalized !== next) {
      applyPreference(normalized)
      broadcastChannel?.postMessage({ preference: normalized })
    }
  } catch (error) {
    console.warn('保存外观设置失败:', error)
  }
}

export const appThemeStore = {
  preference,
  resolvedTheme,
  systemDark,
  loading,
  initialized,
}
