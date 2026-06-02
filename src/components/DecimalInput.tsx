import { useState, useEffect } from 'react'
import { parseDecimal } from '../lib/utils'

interface Props {
  value: number
  onChange: (value: number) => void
  className?: string
  placeholder?: string
  id?: string
}

// Input per importi in euro: accetta la virgola italiana (oltre al punto) e non azzera
// silenziosamente la digitazione parziale (es. "3," mentre si scrive "3,5"). Mantiene
// internamente il testo grezzo e notifica il valore numerico tramite onChange.
export default function DecimalInput({ value, onChange, className, placeholder, id }: Props) {
  const [text, setText] = useState(() => (value ? String(value).replace('.', ',') : ''))

  // Risincronizza quando il valore arriva dall'esterno (reset o precompilazione del form),
  // ma non mentre l'utente digita (se il testo rappresenta già lo stesso numero).
  useEffect(() => {
    if (parseDecimal(text) !== value) {
      setText(value ? String(value).replace('.', ',') : '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <input
      type="text"
      inputMode="decimal"
      id={id}
      value={text}
      placeholder={placeholder}
      onChange={e => {
        const raw = e.target.value.replace(/[^0-9.,]/g, '')
        setText(raw)
        onChange(parseDecimal(raw))
      }}
      className={className}
    />
  )
}
