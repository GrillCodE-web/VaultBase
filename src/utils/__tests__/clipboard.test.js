import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { copyToClipboard, copyText } from '../clipboard.js'

describe('Clipboard Utilities', () => {
  beforeEach(() => {
    // Mock clipboard API (vitest 5: window.navigator — getter-only, прямое
    // присваивание падает; stubGlobal подменяет корректно)
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn(),
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('copyToClipboard', () => {
    it('copies text to clipboard and calls success callback', () => {
      const onSuccess = vi.fn()
      const onError = vi.fn()
      navigator.clipboard.writeText.mockResolvedValueOnce()

      copyToClipboard('test text', onSuccess, onError)

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('test text')
    })

    it('calls error callback on failure', async () => {
      const onSuccess = vi.fn()
      const onError = vi.fn()
      navigator.clipboard.writeText.mockRejectedValueOnce(new Error('Denied'))

      await copyToClipboard('test text', onSuccess, onError)

      expect(onError).toHaveBeenCalled()
    })

    it('handles empty string', () => {
      const onSuccess = vi.fn()
      navigator.clipboard.writeText.mockResolvedValueOnce()

      copyToClipboard('', onSuccess, vi.fn())

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('')
    })

    it('handles special characters', () => {
      const onSuccess = vi.fn()
      navigator.clipboard.writeText.mockResolvedValueOnce()

      copyToClipboard('Special: !@#$%^&*()_+{}|:<>?', onSuccess, vi.fn())

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Special: !@#$%^&*()_+{}|:<>?')
    })

    it('handles unicode characters', () => {
      const onSuccess = vi.fn()
      navigator.clipboard.writeText.mockResolvedValueOnce()

      copyToClipboard('Unicode: 你好世界 🌍', onSuccess, vi.fn())

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Unicode: 你好世界 🌍')
    })

    it('handles newlines and tabs', () => {
      const onSuccess = vi.fn()
      navigator.clipboard.writeText.mockResolvedValueOnce()

      copyToClipboard('Line 1\nLine 2\tTabbed', onSuccess, vi.fn())

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Line 1\nLine 2\tTabbed')
    })
  })

  describe('copyText (simple version)', () => {
    it('copies text without callbacks', () => {
      navigator.clipboard.writeText.mockResolvedValueOnce()

      copyText('test')

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('test')
    })

    it('silently ignores errors', () => {
      navigator.clipboard.writeText.mockRejectedValueOnce(new Error('Denied'))

      // Should not throw
      expect(() => copyText('test')).not.toThrow()
    })
  })

  describe('Fallback behavior', () => {
    it('handles missing clipboard API gracefully', () => {
      const onError = vi.fn()
      const originalClipboard = global.navigator.clipboard
      global.navigator.clipboard = undefined

      // Should call onError when clipboard API is not available
      expect(() => copyToClipboard('test', vi.fn(), onError)).toThrow()

      // Restore
      global.navigator.clipboard = originalClipboard
    })
  })
})
