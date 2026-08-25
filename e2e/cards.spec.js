// @ts-check
import { test, expect } from '@playwright/test'
import { bootApp, navTo, mockState } from './helpers.js'

test.describe('Cards (Tauri IPC mock)', () => {
  test.beforeEach(async ({ page }) => {
    await bootApp(page)
    await navTo(page, 'Cards')
  })

  test('список карт рендерится из get_cards', async ({ page }) => {
    // 20s: Cards.jsx — самый тяжёлый чанк, в полном прогоне (parallel) >10s
    await expect(page.locator('table.tbl tbody tr', { hasText: '1111' })).toBeVisible({ timeout: 20000 })
    await expect(page.locator('table.tbl tbody tr', { hasText: '2222' })).toBeVisible()
  })

  test('строка карты показывает остальные seeded-поля', async ({ page }) => {
    const johnRow = page.locator('table.tbl tbody tr', { hasText: '1111' }).first()
    await expect(johnRow).toBeVisible({ timeout: 20000 })
    await expect(johnRow).toContainText('John Doe')
    await expect(johnRow).toContainText('Wilmington')
    await expect(johnRow).toContainText('12/28')
  })

  test('смена статуса карты через меню в строке (update_card_status + danger-confirm)', async ({ page }) => {
    const johnRow = page.locator('table.tbl tbody tr', { hasText: '1111' }).first()
    await expect(johnRow).toBeVisible({ timeout: 20000 })

    await johnRow.locator('.status-menu-anchor span[role="button"]').first().click()
    // Выпадашка перекрывается соседней строкой — нативный клик по пункту
    const deadBtn = page.locator('.status-menu-dropdown .status-menu-btn', { hasText: 'dead' })
    await deadBtn.evaluate(el => el.click())
    // dead — danger-подтверждение (Cards.jsx handleStatusChange)
    await page.getByRole('button', { name: 'Confirm', exact: true }).click()

    // IPC-граница: команда ушла и применилась в стейте мока
    await expect(async () => {
      const cards = await mockState(page, 'state.cards')
      expect(cards.find(c => c.id === 1).status).toBe('dead')
    }).toPass({ timeout: 10000 })
    // Успешный тост бизнес-операции
    await expect(page.getByText('Marked as dead')).toBeVisible({ timeout: 10000 })
  })

  test('массовое удаление выбранной карты (bulk_delete_cards + confirm)', async ({ page }) => {
    const johnRow = page.locator('table.tbl tbody tr', { hasText: '1111' }).first()
    await expect(johnRow).toBeVisible({ timeout: 20000 })

    // Чекбокс перекрыт td-обработчиком — нативный клик по input
    await johnRow.locator('input[type="checkbox"]').evaluate(el => el.click())

    // Панель массовых действий + кнопка Delete (t('btn_delete'))
    const bulkDelete = page.locator('button', { hasText: /^Delete$/ }).first()
    await bulkDelete.click()

    // useConfirm-диалог: подтверждение
    await page.getByRole('button', { name: 'Confirm', exact: true }).click()

    await expect(page.locator('table.tbl tbody tr', { hasText: '1111' })).toHaveCount(0, { timeout: 10000 })
  })
})
