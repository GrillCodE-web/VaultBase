import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
import { invokeWithRetry } from '../invokeWithRetry.js'

describe('invokeWithRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('возвращает результат при первом успехе без ретраев', async () => {
    invoke.mockResolvedValueOnce({ ok: true })
    const res = await invokeWithRetry('get_cards', { page: 1 })
    expect(res).toEqual({ ok: true })
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('ретраит транзиентную ошибку и в итоге успешен', async () => {
    invoke
      .mockRejectedValueOnce(new Error('database is locked'))
      .mockResolvedValueOnce([1, 2, 3])
    const res = await invokeWithRetry('get_cards', {}, { baseDelay: 1 })
    expect(res).toEqual([1, 2, 3])
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('НЕ ретраит database_locked (приложение заперто)', async () => {
    invoke.mockRejectedValue('database_locked')
    await expect(invokeWithRetry('get_cards', {}, { baseDelay: 1 })).rejects.toBe('database_locked')
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('НЕ ретраит permission_denied', async () => {
    invoke.mockRejectedValue('permission_denied:cards.read')
    await expect(invokeWithRetry('delete_card', {}, { baseDelay: 1 })).rejects.toBe(
      'permission_denied:cards.read'
    )
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('бросает последнюю ошибку после исчерпания ретраев', async () => {
    invoke.mockRejectedValue(new Error('database is locked'))
    await expect(invokeWithRetry('get_cards', {}, { retries: 2, baseDelay: 1 })).rejects.toThrow(
      'database is locked'
    )
    expect(invoke).toHaveBeenCalledTimes(3) // 1 + 2 ретрая
  })

  it('кастомный shouldRetry переопределяет маркеры', async () => {
    invoke.mockRejectedValue(new Error('permission_denied'))
    await expect(
      invokeWithRetry('x', {}, { retries: 1, baseDelay: 1, shouldRetry: () => true })
    ).rejects.toThrow('permission_denied')
    expect(invoke).toHaveBeenCalledTimes(2)
  })
})
