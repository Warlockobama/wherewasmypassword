import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  const styles = {
    primary:
      'bg-amber-glow text-white border-amber-glow hover:brightness-105 shadow disabled:opacity-40 disabled:hover:brightness-100',
    secondary: 'bg-parchment text-dusk border-dusk/50 hover:border-dusk disabled:opacity-40',
    ghost: 'bg-transparent text-dusk/80 border-transparent hover:text-dusk underline underline-offset-2',
  }[variant]
  return (
    <button
      type="button"
      className={`rounded-lg border-2 px-5 py-2 font-semibold transition-all ${styles} ${className}`}
      {...props}
    />
  )
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border-2 border-dusk/30 bg-parchment-dark/60 p-5 shadow-sm ${className}`}>
      {children}
    </div>
  )
}

/** Full-page centered column used by every phase. */
export function Screen({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-full flex-col items-center overflow-y-auto px-4 py-6">
      <div className={`flex w-full flex-col items-center gap-4 ${wide ? 'max-w-3xl' : 'max-w-xl'}`}>{children}</div>
    </div>
  )
}

export function Title({ children }: { children: ReactNode }) {
  return <h1 className="text-center font-display text-3xl text-dusk">{children}</h1>
}

export function Progress({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex gap-1.5">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-2 w-2 rounded-full ${i <= current ? 'bg-amber-glow' : 'bg-dusk/20'}`}
        />
      ))}
    </div>
  )
}
