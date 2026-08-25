// @ts-check
import { test, expect } from '@playwright/test'
import { bootApp, navTo } from './helpers.js'

// TEST-003: фильтрация и поиск. Сид мока:
//   карты  — John Doe 1111 free / Jane Roe 2222 in_use (банки Chase Bank / Capital One)
//   заказы — ORD-1001 pending / ORD-1002 delivered
//   профиль— John Doe (карта 1111, drop_count 1)
//   магазин— Acme Store (acme.com)
//
// ВАЖНО: фильтр Profiles «In Use» (card_status: 'active') тут НЕ тестируем —
// фронт шлёт 'active', а бэкенд матчит c.status ∈ free/in_use/dead/archive
// (_profiles.rs), т.е. фильтр всегда пуст — расхождение продукта, не мока.

const tblRows = p => p.locator('table.tbl tbody tr')

test.describe('TEST-003: Фильтрация — Cards', () => {
  test.beforeEach(async ({ page }) => {
    await bootApp(page)
    await navTo(page, 'Cards')
    // 20s: тяжёлый чанк в dev-Vite (см. cards.spec.js)
    await expect(tblRows(page).filter({ hasText: '1111' })).toHaveCount(1, { timeout: 20000 })
  })

  test('статус-фильтр: Free → 1111, In Use → 2222, All → обе', async ({ page }) => {
    const statusSel = page.locator('select[aria-label="All Statuses"]')
    await statusSel.selectOption('free')
    await expect(tblRows(page).filter({ hasText: '2222' })).toHaveCount(0)
    await expect(tblRows(page).filter({ hasText: '1111' })).toHaveCount(1)

    await statusSel.selectOption('in_use')
    await expect(tblRows(page).filter({ hasText: '1111' })).toHaveCount(0)
    await expect(tblRows(page).filter({ hasText: '2222' })).toHaveCount(1)

    await statusSel.selectOption('')
    await expect(tblRows(page)).toHaveCount(2)
  })

  test('фильтр по банку: Capital One → только карта 2222', async ({ page }) => {
    await page.locator('select[aria-label="Bank"]').selectOption('Capital One')
    await expect(tblRows(page).filter({ hasText: '1111' })).toHaveCount(0)
    await expect(tblRows(page).filter({ hasText: '2222' })).toHaveCount(1)
  })

  test('поиск по last4: 2222 → только Jane Roe', async ({ page }) => {
    await page.locator('input.search-box[aria-label="Search"]').fill('2222')
    await page.keyboard.press('Enter')
    await expect(tblRows(page).filter({ hasText: '1111' })).toHaveCount(0)
    await expect(tblRows(page).filter({ hasText: '2222' })).toHaveCount(1)
  })

  test('поиск без совпадений → empty state', async ({ page }) => {
    await page.locator('input.search-box[aria-label="Search"]').fill('zzzz')
    await page.keyboard.press('Enter')
    await expect(tblRows(page)).toHaveCount(0)
    await expect(page.getByText('No cards found')).toBeVisible({ timeout: 10000 })
  })
})

test.describe('TEST-003: Фильтрация — Orders', () => {
  test.beforeEach(async ({ page }) => {
    await bootApp(page)
    await navTo(page, 'Orders')
    await expect(tblRows(page).filter({ hasText: 'ORD-1001' })).toHaveCount(1, { timeout: 10000 })
  })

  test('статус-табы: Pending → ORD-1001, Delivered → ORD-1002, All → обе', async ({ page }) => {
    await page.locator('button.flt', { hasText: 'Pending' }).click()
    await expect(tblRows(page).filter({ hasText: 'ORD-1002' })).toHaveCount(0)
    await expect(tblRows(page).filter({ hasText: 'ORD-1001' })).toHaveCount(1)

    await page.locator('button.flt', { hasText: 'Delivered' }).click()
    await expect(tblRows(page).filter({ hasText: 'ORD-1001' })).toHaveCount(0)
    await expect(tblRows(page).filter({ hasText: 'ORD-1002' })).toHaveCount(1)

    await page.locator('button.flt', { hasText: 'All', exact: true }).click()
    await expect(tblRows(page).filter({ hasText: 'ORD-1001' })).toHaveCount(1)
    await expect(tblRows(page).filter({ hasText: 'ORD-1002' })).toHaveCount(1)
  })

  test('поиск по номеру заказа (Enter): 1002 → только ORD-1002', async ({ page }) => {
    await page.locator('input.search-box').fill('1002')
    // Особенность Orders: load игнорирует аргументы и читает фильтры из стóра, а search
    // попадает в стор только после 300ms-дебаунса — Enter сразу после набора
    // фетчит с search=null. Ждём дебаунс, затем Enter (рабочий путь пользователя).
    await page.waitForTimeout(600)
    await page.keyboard.press('Enter')
    await expect(tblRows(page).filter({ hasText: 'ORD-1001' })).toHaveCount(0)
    await expect(tblRows(page).filter({ hasText: 'ORD-1002' })).toHaveCount(1)
  })
})

test.describe('TEST-003: Фильтрация — Profiles', () => {
  test.beforeEach(async ({ page }) => {
    await bootApp(page)
    await navTo(page, 'Profiles')
    await expect(tblRows(page).filter({ hasText: 'John Doe' })).toHaveCount(1, { timeout: 10000 })
  })

  test('Has Drop → сид-профиль; No Drop → пусто; All → возврат', async ({ page }) => {
    await page.locator('button.flt', { hasText: 'Has Drop' }).click()
    await expect(tblRows(page).filter({ hasText: 'John Doe' })).toHaveCount(1)

    await page.locator('button.flt', { hasText: 'No Drop' }).click()
    // EmptyState у Profiles рендерится как строка таблицы (tr>td colspan) —
    // поэтому пусто = ноль строк с 'John Doe', а не ноль tr вообще
    await expect(tblRows(page).filter({ hasText: 'John Doe' })).toHaveCount(0)
    await expect(page.getByText('No profiles found')).toBeVisible({ timeout: 10000 })

    await page.locator('button.flt', { hasText: 'All', exact: true }).click()
    await expect(tblRows(page).filter({ hasText: 'John Doe' })).toHaveCount(1)
  })

  test('поиск по last4: 1111 → профиль, 9999 → пусто', async ({ page }) => {
    await page.locator('input.search-box').fill('1111')
    await page.keyboard.press('Enter')
    await expect(tblRows(page).filter({ hasText: 'John Doe' })).toHaveCount(1)

    await page.locator('input.search-box').fill('9999')
    await page.keyboard.press('Enter')
    await expect(tblRows(page).filter({ hasText: 'John Doe' })).toHaveCount(0)
    await expect(page.getByText('No profiles found')).toBeVisible({ timeout: 10000 })
  })
})

test.describe('TEST-003: Поиск — Shops', () => {
  test.beforeEach(async ({ page }) => {
    await bootApp(page)
    await navTo(page, 'Shops')
    await expect(tblRows(page).filter({ hasText: 'Acme Store' })).toHaveCount(1, { timeout: 10000 })
  })

  test('поиск по имени (debounce): acme → магазин, unknown → empty state', async ({ page }) => {
    await page.locator('input.search-box').fill('acme')
    await expect(tblRows(page).filter({ hasText: 'Acme Store' })).toHaveCount(1)

    await page.locator('input.search-box').fill('noshop')
    await expect(tblRows(page)).toHaveCount(0)
    await expect(page.getByText('Nothing found for this search')).toBeVisible({ timeout: 10000 })
  })
})

test.describe('TEST-003: Глобальный поиск', () => {
  test.beforeEach(async ({ page }) => {
    await bootApp(page)
    await page.locator('#search-button').click()
    await expect(page.locator('.search-overlay')).toBeVisible()
  })

  test('Control+K открывает оверлей поиска', async ({ page }) => {
    await page.keyboard.press('Escape')
    await expect(page.locator('.search-overlay')).toBeHidden()

    await page.keyboard.press('Control+k')
    await expect(page.locator('.search-overlay')).toBeVisible()
    await expect(page.locator('.search-main-input')).toBeFocused()
  })

  test('запрос 1111 → секция Cards с одним результатом', async ({ page }) => {
    await page.locator('.search-main-input').fill('1111')
    await expect(page.locator('.search-result-row')).toHaveCount(1, { timeout: 10000 })
    const row = page.locator('.search-result-row').first()
    await expect(row).toContainText('••••1111')
    await expect(row).toContainText('card')
    await expect(row).toContainText('free')
    await expect(page.locator('.search-section-label', { hasText: 'Cards' })).toBeVisible()
  })

  test('результат-заказ ведёт на страницу Orders', async ({ page }) => {
    await page.locator('.search-main-input').fill('1002')
    const row = page.locator('.search-result-row', { hasText: 'ORD-1002' })
    await expect(row).toBeVisible({ timeout: 10000 })
    await row.click()

    await expect(page.locator('.search-overlay')).toBeHidden()
    await expect(tblRows(page).filter({ hasText: 'ORD-1002' })).toHaveCount(1, { timeout: 20000 })
  })

  test('нет совпадений → «No results», Escape закрывает', async ({ page }) => {
    await page.locator('.search-main-input').fill('zzzz')
    await expect(page.getByText('No results for "zzzz"')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.search-result-row')).toHaveCount(0)

    await page.keyboard.press('Escape')
    await expect(page.locator('.search-overlay')).toBeHidden()
  })
})
