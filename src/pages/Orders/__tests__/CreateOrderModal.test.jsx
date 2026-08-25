import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { CreateOrderModal } from '../CreateOrderModal.jsx'
import { LangProvider } from '../../../hooks/useLang'

// BUG-016: deterministic regression tests для гонок в CreateOrderModal.
// invoke подменяется на контролируемые deferred-обещания, чтобы «медленный
// устаревший» ответ приходил строго ПОСЛЕ свежего — без fix'а каждый из
// трёх сценариев ниже перезатирал свежие данные.
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

vi.mock('../../../hooks/usePremiumToast', () => ({
  usePremiumToast: () => ({
    toast: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismissAll: vi.fn(),
  }),
}))

function deferred() {
  let resolve
  const promise = new Promise(res => {
    resolve = res
  })
  return { promise, resolve }
}

function baseInvoke(overrides = {}) {
  return (cmd, args) => {
    if (cmd in overrides) {
      const v = overrides[cmd]
      return Promise.resolve(typeof v === 'function' ? v(args) : v)
    }
    switch (cmd) {
      case 'get_profiles':
        return Promise.resolve({ items: [] })
      case 'get_shops':
        return Promise.resolve({ items: [] })
      case 'search_catalog_shops':
        return Promise.resolve([])
      case 'search_catalog_items':
        return Promise.resolve([])
      case 'get_emails':
        return Promise.resolve({ items: [] })
      case 'get_proxies':
        return Promise.resolve({ items: [] })
      case 'get_order_templates':
        return Promise.resolve([])
      case 'get_shop_smart_suggestions':
        return Promise.resolve([])
      default:
        return Promise.resolve(null)
    }
  }
}

function renderModal() {
  return render(
    <LangProvider>
      <CreateOrderModal onCreated={vi.fn()} onClose={vi.fn()} />
    </LangProvider>
  )
}

// NB: в en.js плейсхолдер использует U+2026 (…), поэтому ищем по регэкспу
const shopInput = () => screen.getByPlaceholderText(/Search shops/)

const callCount = cmd => invokeMock.mock.calls.filter(c => c[0] === cmd).length

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BUG-016: CreateOrderModal race conditions', () => {
  it('устаревший ответ поиска магазина не затирает более свежие результаты', async () => {
    const stale = deferred()
    const fresh = deferred()
    let getShopsCall = 0
    invokeMock.mockImplementation((cmd, args) => {
      if (cmd === 'get_shops') {
        getShopsCall++
        return getShopsCall === 1 ? stale.promise : fresh.promise
      }
      return baseInvoke()(cmd, args)
    })

    renderModal()
    fireEvent.change(shopInput(), { target: { value: 'am' } })
    fireEvent.change(shopInput(), { target: { value: 'amaz' } })
    expect(callCount('get_shops')).toBe(2)

    // Свежий запрос отвечает первым
    await act(async () => {
      fresh.resolve({ items: [{ id: 2, name: 'Fresh Shop', domain: 'fresh.shop' }] })
    })
    expect(await screen.findByText('Fresh Shop')).toBeInTheDocument()

    // Теперь отвечает медленный устаревший — не должен перезаписать список
    await act(async () => {
      stale.resolve({ items: [{ id: 1, name: 'Old Shop', domain: 'old.shop' }] })
    })
    expect(screen.queryByText('Old Shop')).toBeNull()
    expect(screen.getByText('Fresh Shop')).toBeInTheDocument()
  })

  it('двойной клик по каталогному магазину создаёт его только один раз', async () => {
    const create = deferred()
    invokeMock.mockImplementation((cmd, args) =>
      baseInvoke({
        search_catalog_shops: [{ id: 101, domain: 'catalog.shop', category: 'misc' }],
        get_shops: { items: [] },
        create_shop: create.promise,
      })(cmd, args)
    )

    renderModal()
    fireEvent.change(shopInput(), { target: { value: 'cat' } })
    const btn = (await screen.findByText('catalog.shop')).closest('button')

    fireEvent.click(btn)
    fireEvent.click(btn) // второй клик пока quick-create в полёте

    expect(callCount('create_shop')).toBe(1)

    await act(async () => {
      create.resolve({ id: 55, domain: 'catalog.shop' })
    })
    await waitFor(() => expect(shopInput()).toHaveValue('catalog.shop'))
  })

  it('устаревший quick-create не перезаписывает более новый выбор локального магазина', async () => {
    const create = deferred()

    renderModal()
    invokeMock.mockImplementation((cmd, args) => {
      if (cmd === 'get_shops') {
        return Promise.resolve({
          items: args.search === 'loc' ? [{ id: 3, name: 'Local Shop', domain: 'local.shop' }] : [],
        })
      }
      return baseInvoke({
        search_catalog_shops: args.q === 'cat' ? [{ id: 201, domain: 'cat.shop' }] : [],
        create_shop: create.promise,
      })(cmd, args)
    })

    fireEvent.change(shopInput(), { target: { value: 'cat' } })
    fireEvent.click((await screen.findByText('cat.shop')).closest('button'))

    // Пока quick-create каталога в полёте, пользователь выбирает локальный
    fireEvent.change(shopInput(), { target: { value: 'loc' } })
    fireEvent.click((await screen.findByText('Local Shop')).closest('button'))
    await waitFor(() => expect(shopInput()).toHaveValue('Local Shop'))

    // Медленный quick-create отвечает ПОСЛЕ выбора — не должен его перезаписать
    await act(async () => {
      create.resolve({ id: 77, domain: 'cat.shop' })
    })
    expect(shopInput()).toHaveValue('Local Shop')
  })
})
