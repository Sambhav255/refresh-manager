import { useState } from 'react'

// Hoisted to module scope so it doesn't remount (losing input focus) on every
// parent render. Supports both tap (+/−) and direct typing, clamped to
// [min, max]. When min is 0, stepping/typing down to 0 lets the parent remove
// the row (restaurant cart behavior).
export function QtyStepper({ value, min = 1, max, disabled, onChange, onEnter, compact = false }) {
  const [text, setText] = useState(String(value))
  // Resync the draft text when the committed value changes from outside
  // (recommended adjust-state-during-render pattern, no effect needed).
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    setText(String(value))
  }
  const clamp = (n) => Math.max(min, Math.min(max, n))
  return (
    <div style={{ display: 'flex', gap: compact ? 6 : 8, alignItems: 'center' }}>
      <button
        className="btn btn-ghost"
        style={{ padding: compact ? '2px 8px' : '2px 10px' }}
        disabled={disabled || value <= min}
        aria-label="Decrease quantity"
        onClick={() => onChange(clamp(value - 1))}
      >
        −
      </button>
      <input
        className="input"
        style={{
          width: compact ? 46 : 56,
          padding: compact ? '3px 4px' : '4px 6px',
          textAlign: 'center'
        }}
        inputMode="numeric"
        value={text}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9]/g, '')
          setText(raw)
          if (raw === '') return
          const n = clamp(parseInt(raw, 10))
          if (String(n) !== raw) setText(String(n))
          onChange(n)
        }}
        onBlur={() => setText(String(value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) {
            e.preventDefault()
            onEnter()
          }
        }}
      />
      <button
        className="btn btn-ghost"
        style={{ padding: compact ? '2px 8px' : '2px 10px' }}
        disabled={disabled || value >= max}
        aria-label="Increase quantity"
        onClick={() => onChange(clamp(value + 1))}
      >
        +
      </button>
    </div>
  )
}
