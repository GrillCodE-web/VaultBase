// @ts-check
// TEST-002: CRUD всех сущностей через реальный UI (мок stateful — изменения видны).
// Cards: R/U(статус)/D(массовое) · Profiles: C/R/копия/D · Orders: U(статус)/D · Shops: C/R/U/D.
// Создание карт импортом удалено (MGR-018, этап B): карты приходят срезами от менеджера.
import { test, expect } from '@playwright/test'
import { bootApp, navTo, mockState } from './helpers.js'

test.describe('TEST-002: CRUD — Cards', () => {
  test.beforeEach(async ({ page }) => {
    await bootApp(page)
    await navTo(page, 'Cards')
    // 20s: Cards.jsx — самый тяжёлый чанк, на холодном dev-Vite компилируется >10s
    await expect(page.locator('table.tbl tbody tr', { hasText: '1111' })).toBeVisible({ timeout: 20000 })
  })

  test('Update: статус карты через меню строки', async ({ page }) => {
    const row = page.locator('table.tbl tbody tr', { hasText: '1111' }).first()
    await row.locator('.status-menu-anchor span[role="button"]').first().click()
    // Карта уже free → в меню только dead/archive; archive идёт без confirm
    const archiveBtn = page.locator('.status-menu-dropdown .status-menu-btn', { hasText: 'archive' })
    await archiveBtn.evaluate(el => el.click())
    await expect(async () => {
      const cards = await mockState(page, 'state.cards')
      expect(cards.find(c => c.id === 1).status).toBe('archive')
    }).toPass({ timeout: 10000 })
    await expect(page.getByText('Marked as archive')).toBeVisible({ timeout: 10000 })
  })

  test('Delete: массовое удаление с подтверждением', async ({ page }) => {
    const row = page.locator('table.tbl tbody tr', { hasText: '2222' }).first()
    await row.locator('input[type="checkbox"]').evaluate(el => el.click())
    await page.locator('button', { hasText: /^Delete$/ }).first().click()
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()
    await dialog.locator('button').last().click()
    await expect(page.locator('table.tbl tbody tr', { hasText: '2222' })).toHaveCount(0, { timeout: 10000 })
  })
})

test.describe('TEST-002: CRUD — Profiles', () => {
  test.beforeEach(async ({ page }) => {
    await bootApp(page)
    await navTo(page, 'Profiles')
    await expect(page.locator('table.tbl tbody tr', { hasText: 'John Doe' }).first()).toBeVisible({ timeout: 10000 })
  })

  test('Create: профиль из свободной карты с авто-дропом', async ({ page }) => {
    await page.locator('button', { hasText: /new profile/i }).first().click()
    const modal = page.locator('.modal')
    await expect(modal).toBeVisible()

    // Список свободных карт: элементы показывают last4/тип/банк (не holder)
    const cardItem = modal.locator('.card-selection-item', { hasText: '1111' }).first()
    await cardItem.click()

    // UX-019: авто-дроп по умолчанию выкл — включаем чекбокс и подтверждаем диалог
    // (controlled input: .check() не подходит — состояние меняется только после Confirm)
    await modal
      .locator('label.checkbox-label', { hasText: 'Auto-create drop' })
      .locator('input[type="checkbox"]')
      .click()
    await page.locator('[role="dialog"] button', { hasText: 'Confirm' }).click()

    await modal.locator('button', { hasText: 'New Profile' }).last().click()
    await expect(modal).toBeHidden({ timeout: 10000 })

    // Профиль создан, авто-дроп добавлен
    await expect(async () => {
      const profiles = await mockState(page, 'state.profiles')
      expect(profiles.length).toBe(2)
      expect(profiles[1].drop_count).toBe(1)
    }).toPass({ timeout: 10000 })
    // Карта занята профилем
    const cards = await mockState(page, 'state.cards')
    expect(cards.find(c => c.id === 1).status).toBe('in_use')
  })

  test('копия профиля через меню действий', async ({ page }) => {
    const row = page.locator('table.tbl tbody tr', { hasText: 'John Doe' }).first()
    await row.locator('button[aria-label="Open actions menu"]').click()
    // Duplicate = t('profile_duplicated').split(' ')[0] => 'Profile'
    await page.locator('[role="menuitem"]', { hasText: /^Profile$/ }).click()
    await expect(async () => {
      const profiles = await mockState(page, 'state.profiles')
      expect(profiles.length).toBe(2)
    }).toPass({ timeout: 10000 })
  })

  test('Delete: удаление профиля через меню действий (без confirm-диалога)', async ({ page }) => {
    const row = page.locator('table.tbl tbody tr', { hasText: 'John Doe' }).first()
    await row.locator('button[aria-label="Open actions menu"]').click()
    await page.locator('[role="menuitem"]', { hasText: /^Delete$/ }).click()
    await expect(async () => {
      const profiles = await mockState(page, 'state.profiles')
      expect(profiles.length).toBe(0)
    }).toPass({ timeout: 10000 })
    await expect(page.locator('table.tbl tbody tr', { hasText: 'John Doe' })).toHaveCount(0, { timeout: 10000 })
  })
})

test.describe('TEST-002: CRUD — Orders', () => {
  test.beforeEach(async ({ page }) => {
    await bootApp(page)
    await navTo(page, 'Orders')
    await expect(page.locator('table.tbl tbody tr', { hasText: 'ORD-1001' })).toBeVisible({ timeout: 10000 })
  })

  test('Update: смена статуса через выбор + bulk-кнопку', async ({ page }) => {
    const row = page.locator('table.tbl tbody tr', { hasText: 'ORD-1001' }).first()
    // NOTE: меню статусов в строке мертво (capture-баг, см. orders-flow.spec) —
    // рабочий путь пользователя: выбрать заказ → «→ Processing» в тулбаре
    await row.locator('input[type="checkbox"]').evaluate(el => el.click())
    await page.getByRole('button', { name: '→ Processing' }).click()
    await expect(row).toContainText('processing', { timeout: 10000 })
    const orders = await mockState(page, 'state.orders')
    expect(orders.find(o => o.id === 'o1').status).toBe('processing')
  })

  test('Delete: удаление заказа с подтверждением-тостом', async ({ page }) => {
    const row = page.locator('table.tbl tbody tr', { hasText: 'ORD-1001' }).first()
    await row.locator('button[aria-label="Delete"]').click()
    // Soft-delete: тост + фактическое удаление через 5с (undo-окно)
    await expect(page.locator('text=Order deleted')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('table.tbl tbody tr', { hasText: 'ORD-1001' })).toHaveCount(0, { timeout: 10000 })
  })

  test('Read: трек-номер и перевозчик отображаются у delivered-заказа', async ({ page }) => {
    const row = page.locator('table.tbl tbody tr', { hasText: 'ORD-1002' }).first()
    await expect(row).toContainText('1Z999AA1OLD')
    await expect(row).toContainText('FedEx')
  })
})

test.describe('TEST-002: CRUD — Shops', () => {
  test.beforeEach(async ({ page }) => {
    await bootApp(page)
    await navTo(page, 'Shops')
    await expect(page.locator('table.tbl tbody tr', { hasText: 'Acme Store' })).toBeVisible({ timeout: 10000 })
  })

  test('Create + Update + Delete магазина', async ({ page }) => {
    // Create
    await page.locator('button', { hasText: /new shop/i }).first().click()
    const modal = page.locator('.modal')
    await expect(modal.locator('#shop-modal-title')).toHaveText('New Shop')
    await modal.locator('input[placeholder*="Nike"]').fill('E2E Shop')
    await modal.locator('input[placeholder*="nike.com"]').fill('https://e2e-shop.example.com')
    await modal.locator('input[placeholder*="Electronics"]').fill('Retail')
    await modal.getByRole('button', { name: 'Create Shop' }).click()
    await expect(modal).toBeHidden({ timeout: 10000 })

    const shopRow = page.locator('table.tbl tbody tr', { hasText: 'E2E Shop' }).first()
    await expect(shopRow).toBeVisible({ timeout: 10000 })
    await expect(shopRow).toContainText('e2e-shop.example.com')

    // Update: кнопка Edit прямо в строке (НЕ td.first().click() — клик по центру
    // чекбокс-ячейки w-8 попадает в чекбокс и выделяет строку)
    await shopRow.locator('button', { hasText: /^Edit$/ }).click()
    await expect(modal.locator('#shop-modal-title')).toHaveText('Edit Shop')
    await modal.locator('input[placeholder="Nike, Amazon, etc."]').fill('E2E Shop Reloaded')
    await modal.getByRole('button', { name: 'Save Changes' }).click()
    await expect(modal).toBeHidden({ timeout: 10000 })
    await expect(page.locator('table.tbl tbody tr', { hasText: 'E2E Shop Reloaded' }).first()).toBeVisible({ timeout: 10000 })

    // Delete через выбор чекбокса + Delete Selected
    const updatedRow = page.locator('table.tbl tbody tr', { hasText: 'E2E Shop Reloaded' }).first()
    await updatedRow.locator('input[type="checkbox"]').evaluate(el => el.click())
    await page.locator('button', { hasText: /delete selected/i }).click()
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible()
    await dialog.locator('button').last().click()
    await expect(page.locator('table.tbl tbody tr', { hasText: 'E2E Shop Reloaded' })).toHaveCount(0, { timeout: 10000 })
    // Acme остался
    await expect(page.locator('table.tbl tbody tr', { hasText: 'Acme Store' })).toBeVisible()
  })
})
