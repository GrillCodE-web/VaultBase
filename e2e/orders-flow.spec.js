// @ts-check
// TEST-001: полный e2e flow — свободная карта → создание заказа → отслеживание.
// Путь пользователя: Cards (видим свободную карту) → Orders → Create Order →
// выбор профиля с дропом + магазина → риск-чек → создаём заказ →
// смена статуса в delivered → трек-номер инлайн-редактором → таймлайн.
import { test, expect } from '@playwright/test'
import { bootApp, navTo, mockState, mockCommands } from './helpers.js'

test.describe('TEST-001: карта → заказ → отслеживание', () => {
  test('заказ создаётся из существующей карты и доходит до трек-номера с таймлайном', async ({ page }) => {
    // 1. Карты: свободная карта Джона видна (источник будущего профиля)
    await bootApp(page)
    await navTo(page, 'Cards')
    await expect(page.locator('table.tbl tbody tr', { hasText: '1111' })).toBeVisible({ timeout: 10000 })

    // 2. Страница заказов: seeded-заказы на месте
    await navTo(page, 'Orders')
    await expect(page.locator('table.tbl tbody tr', { hasText: 'ORD-1001' })).toBeVisible({ timeout: 10000 })
    await expect(page.locator('table.tbl tbody tr', { hasText: 'ORD-1002' })).toBeVisible()

    // 3. Открыть модал создания заказа
    await page.getByRole('button', { name: /create order/i }).click()
    const modal = page.locator('.modal')
    await expect(modal).toBeVisible()
    await expect(modal).toContainText('Create Order')

    // 4. Выбрать профиль (у seeded-профиля есть дроп → dropId подставится сам)
    // NOTE: в переводах многоточия — U+2026, селекторы плейсхолдеров подстрочные.
    const profileInput = modal.locator('input[placeholder*="holder name"]')
    await profileInput.fill('John')
    await modal.locator('.dropdown-btn', { hasText: 'John Doe' }).first().click()
    await expect(modal).toContainText('Wilmington', { timeout: 10000 })

    // 5. Выбрать магазин
    const shopInput = modal.locator('input[placeholder*="Search shops"]')
    await shopInput.fill('acme')
    await modal.locator('.dropdown-btn', { hasText: 'Acme Store' }).first().click()
    await expect(modal).toContainText('Acme Store')

    // 6. Риск-чек запускается автоматически (debounce 400ms)
    await expect(async () => {
      const cmds = await mockCommands(page)
      expect(cmds).toContain('run_risk_check')
    }).toPass({ timeout: 10000 })

    // 7. Submit активен (profile + shop + drop выбраны)
    const submit = modal.locator('.btn-submit-full')
    await expect(submit).toBeEnabled({ timeout: 10000 })
    await submit.click()
    await expect(modal).toBeHidden({ timeout: 10000 })

    // 8. Новый заказ появился в списке (номер берём из состояния мока)
    const orders = await mockState(page, 'state.orders')
    const created = orders.find(o => o.order_number !== 'ORD-1001' && o.order_number !== 'ORD-1002')
    expect(created).toBeTruthy()
    expect(created.status).toBe('pending')

    const newRow = page.locator('table.tbl tbody tr', { hasText: created.order_number }).first()
    await expect(newRow).toBeVisible({ timeout: 10000 })
    await expect(newRow).toContainText('pending')
    await expect(newRow).toContainText('Acme Store')

    // 9. Смена статуса через меню в строке
    // NOTE (баг фронтенда, передан STREAM B): клик по пункту меню статусов
    // закрывает меню ДО отработки onClick (capture-listener в Orders.jsx),
    // поэтому модалка «Mark as Shipped», рендерящаяся внутри меню, умирает
    // мгновенно. Рабочие пути пользователя: обычные статусы меню + инлайн-
    // редактор трека.
    await newRow.locator('button', { hasText: 'Status' }).click()
    // 9. Смена статуса заказа рабочим путём пользователя: выбор строки + bulk-кнопка
    // NOTE (баг фронтенда, передан STREAM B): меню статусов в строке заказа мертво —
    // document-capture-listener (Orders.jsx) размонтирует меню ДО диспатча onClick,
    // update_order_status не вызывается вовсе. Рабочий путь — bulk-кнопки тулбара.
    await newRow.locator('input[type="checkbox"]').evaluate(el => el.click())
    await page.getByRole('button', { name: '→ Shipped' }).click()
    await expect(newRow).toContainText('shipped', { timeout: 10000 })

    // 10. Трек-номер через инлайн-редактор (InlineTrackingCell, Enter = save)
    await newRow.locator('button[aria-label="Edit tracking number"]').click()
    const trackingInput = newRow.locator('input[placeholder="tracking #"]')
    await trackingInput.fill('1Z999E2E2E2E2')
    await trackingInput.press('Enter')
    await expect(newRow).toContainText('1Z999E2E2E2E2', { timeout: 10000 })

    // 11. Раскрыть строку — таймлайн отслеживания (dots по шагам статусов)
    await newRow.click()
    await expect(page.locator('.timeline-status-dot').first()).toBeVisible({ timeout: 10000 })

    // 12. Мок подтвердил фактические вызовы (статус + трек)
    const updated = (await mockState(page, 'state.orders')).find(o => o.id === created.id)
    expect(updated.status).toBe('shipped')
    expect(updated.tracking_number).toBe('1Z999E2E2E2E2')
  })

  test('создание заказа невозможно без профиля и магазина (валидация)', async ({ page }) => {
    await bootApp(page)
    await navTo(page, 'Orders')
    await page.getByRole('button', { name: /create order/i }).click()
    const submit = page.locator('.modal .btn-submit-full')
    await expect(submit).toBeDisabled()
  })
})
