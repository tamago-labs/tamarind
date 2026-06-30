import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { usePkg } from '../hooks/usePkg'

export type HeaderTheme = 'dark' | 'light'

interface AppHeaderProps {
  theme?: HeaderTheme
}

export function AppHeader({ theme = 'dark' }: AppHeaderProps) {
  const pkg = usePkg()
  const isLight = theme === 'light'
  return (
    <motion.header
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className='flex w-full items-center justify-between px-8 py-5'
    >
      <div className='flex items-center gap-2'>
        <Sparkles
          className={`h-6 w-6 ${isLight ? 'text-tamarind-700' : 'text-tamarind-300'}`}
          aria-hidden='true'
        />
        <span
          className={`bg-clip-text text-xl font-bold tracking-tight text-transparent ${
            isLight
              ? 'bg-gradient-to-r from-tamarind-700 to-tamarind-900'
              : 'bg-gradient-to-r from-tamarind-300 to-white'
          }`}
        >
          Tamarind
        </span>
      </div>
      {pkg.version && (
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium backdrop-blur ${
            isLight ? 'bg-tamarind-900/5 text-tamarind-700/80' : 'bg-white/10 text-white/80'
          }`}
          aria-label={`Version ${pkg.version}`}
        >
          v{pkg.version}
        </span>
      )}
    </motion.header>
  )
}
