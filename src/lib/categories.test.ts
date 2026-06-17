import { describe, it, expect } from 'vitest'
import { mergeCategories } from './categories'

describe('mergeCategories', () => {
  it('aggiunge le personalizzate dopo i default', () => {
    expect(mergeCategories(['casa', 'cibo'], ['palestra', 'hobby'])).toEqual(['casa', 'cibo', 'palestra', 'hobby'])
  })

  it('non duplica una personalizzata uguale a un default', () => {
    expect(mergeCategories(['casa', 'cibo'], ['cibo', 'palestra'])).toEqual(['casa', 'cibo', 'palestra'])
  })

  it('senza personalizzate restituisce i soli default (stesso ordine)', () => {
    expect(mergeCategories(['casa', 'cibo'], [])).toEqual(['casa', 'cibo'])
  })

  it('mantiene l\'ordine dei default in testa', () => {
    expect(mergeCategories(['a', 'b', 'c'], ['z'])).toEqual(['a', 'b', 'c', 'z'])
  })
})
