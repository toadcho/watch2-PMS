import { ref, watch } from 'vue'
import { useTheme as useVuetifyTheme } from 'vuetify'

export interface ThemeConfig {
  preset: string
  primaryColor: string
  headerColor: string
  fontSize: 'small' | 'medium' | 'large'
}

export const THEME_PRESETS: Record<string, { label: string; primary: string; header: string; primaryLight: string; primaryDark: string }> = {
  blue:   { label: '기본 (파랑)', primary: '#1976D2', header: '#1976D2', primaryLight: '#E3F2FD', primaryDark: '#1565C0' },
  indigo: { label: '남색',       primary: '#3F51B5', header: '#3F51B5', primaryLight: '#E8EAF6', primaryDark: '#303F9F' },
  teal:   { label: '청록',       primary: '#00897B', header: '#00897B', primaryLight: '#E0F2F1', primaryDark: '#00695C' },
  green:  { label: '초록',       primary: '#388E3C', header: '#388E3C', primaryLight: '#E8F5E9', primaryDark: '#2E7D32' },
  purple: { label: '보라',       primary: '#7B1FA2', header: '#7B1FA2', primaryLight: '#F3E5F5', primaryDark: '#6A1B9A' },
  red:    { label: '레드',       primary: '#C62828', header: '#C62828', primaryLight: '#FFEBEE', primaryDark: '#B71C1C' },
  grey:   { label: '그레이',     primary: '#546E7A', header: '#455A64', primaryLight: '#ECEFF1', primaryDark: '#37474F' },
}

const FONT_SIZES = {
  small:  { title: '14px', subtitle: '12px', body: '11px', label: '10px', caption: '9px', mini: '7px' },
  medium: { title: '15px', subtitle: '13px', body: '12px', label: '11px', caption: '10px', mini: '8px' },
  large:  { title: '16px', subtitle: '14px', body: '13px', label: '12px', caption: '11px', mini: '9px' },
}

const DEFAULT_THEME: ThemeConfig = { preset: 'blue', primaryColor: '#1976D2', headerColor: '#1976D2', fontSize: 'medium' }

const currentTheme = ref<ThemeConfig>({ ...DEFAULT_THEME })

export function useProjectTheme() {
  const vuetifyTheme = useVuetifyTheme()

  function applyTheme(config: ThemeConfig) {
    currentTheme.value = { ...config }
    const preset = THEME_PRESETS[config.preset] || THEME_PRESETS.blue
    const primary = config.primaryColor || preset.primary
    const header = config.headerColor || preset.header
    const primaryLight = preset.primaryLight
    const primaryDark = preset.primaryDark
    const fonts = FONT_SIZES[config.fontSize] || FONT_SIZES.medium

    // CSS Variables
    const root = document.documentElement
    root.style.setProperty('--pms-primary', primary)
    root.style.setProperty('--pms-primary-light', primaryLight)
    root.style.setProperty('--pms-primary-dark', primaryDark)
    root.style.setProperty('--pms-font-title', fonts.title)
    root.style.setProperty('--pms-font-subtitle', fonts.subtitle)
    root.style.setProperty('--pms-font-body', fonts.body)
    root.style.setProperty('--pms-font-label', fonts.label)
    root.style.setProperty('--pms-font-caption', fonts.caption)
    root.style.setProperty('--pms-font-mini', fonts.mini)

    // Vuetify theme
    vuetifyTheme.themes.value.light.colors.primary = primary

    // Header color (stored as CSS variable for AppBar)
    root.style.setProperty('--pms-header-color', header)
  }

  function resetTheme() {
    applyTheme(DEFAULT_THEME)
  }

  return { currentTheme, applyTheme, resetTheme, THEME_PRESETS, FONT_SIZES, DEFAULT_THEME }
}
