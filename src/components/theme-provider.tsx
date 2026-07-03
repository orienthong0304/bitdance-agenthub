'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'

/**
 * 主题 Provider。基于 next-themes，用 class 切换（.dark 加在 html）。
 * defaultTheme='light'：首次打开（无持久化偏好）默认浅色，对齐设计稿基准；
 * enableSystem 保留，已保存的用户偏好（含显式 system）不受影响。
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  )
}
