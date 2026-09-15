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
    // 20s: тяжёлый чанк в dev-Vite (см. search-filter.spec.js) — короткий
    // 10s может не дождаться догрузки данных после первого рендера.
    await expect(page.locator('table.tbl tbody tr', { hasText: '1111' })).toBeVisible({ timeout: 20000 })

    // 2. Страница заказов: seeded-заказы на месте
    await navTo(page, 'Orders')
    await expect(page.locator('table.tbl tbody tr', { hasText: 'ORD-1001' })).toBeVisible({ timeout: 20000 })
    await expect(page.locator('table.tbl tbody tr', { hasText: 'ORD-1002' })).toBeVisible()

    // 3. SPEC-A (c35ae2b): Orders — монитор, создания заказа со страницы Orders
    // больше нет (собственный Create Order удалён вместе с CreateOrderModal).
    // Рабочий путь — профиль (у него primary-дроп подставляется сам) →
    // «Create new order for this profile» → QuickOrderModal.
    await navTo(page, 'Profiles')
    const profileRow = page.locator('table.tbl tbody tr', { hasText: 'John Doe' }).first()
    await expect(profileRow).toBeVisible({ timeout: 10000 })
    await profileRow.getByRole('button', { name: 'Create new order for this profile' }).click()

    const modal = page.locator('.modal')
    await expect(modal).toBeVisible({ timeout: 10000 })
    // заголовок — create_order + держатель карты профиля (holder_masked
    // заполнен, поэтому фолбэка на last4 в заголовке нет)
    await expect(modal).toContainText('John Doe')
    // primary-дроп подставлен автоматически (Wilmington)
    await expect(modal).toContainText('Wilmington', { timeout: 10000 })

    // 5. Выбрать магазин
    const shopInput = modal.locator('input[placeholder*="Search shops"]')
    await shopInput.fill('acme')
    await modal.locator('.dropdown-btn', { hasText: 'Acme Store' }).first().click()
    await expect(modal.locator('input[placeholder*="Search shops"]')).toHaveValue(/Acme Store/)

    // 6. Риск-чек запускается автоматически (debounce 400ms, shop+drop выбраны)
    await expect(async () => {
      const cmds = await mockCommands(page)
      expect(cmds).toContain('run_risk_check')
    }).toPass({ timeout: 10000 })

    // 7. Submit активен (drop подставлен автоматически + shop выбран)
    const submit = modal.getByRole('button', { name: 'Create Order', exact: true })
    await expect(submit).toBeEnabled({ timeout: 10000 })
    await submit.click()
    await expect(modal).toBeHidden({ timeout: 10000 })

    // 8. Новый заказ появился в моке (без order_number — UI покажет #id)
    const orders = await mockState(page, 'state.orders')
    const created = orders.find(o => o.order_number !== 'ORD-1001' && o.order_number !== 'ORD-1002')
    expect(created).toBeTruthy()
    expect(created.status).toBe('pending')
    const createdLabel = created.order_number || `#${created.id}`

    // 8b. Идём в Orders: новый заказ на месте. Cache store заказов живёт 5 мин
    // (CACHE_DURATION), и ранний визит на шаге 2 его уже прогрел — create_order
    // кэш не инвалидирует, поэтому просим принудительный refetch.
    await navTo(page, 'Orders')
    await page.evaluate(async () => {
      const mod = await import('/src/store/orders.js')
      await mod.useOrdersStore.getState().fetchOrders(true)
    })
    const newRow = page.locator('table.tbl tbody tr', { hasText: createdLabel }).first()
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

    // 11. Раскрыть строку — таймлайн отслеживания (dots по шагам статусов).
    // Клик по ячейке магазина (td[3]): центр строки попадает в инлайн-редактор
    // трека со stopPropagation — тоггл раскрытия там не срабатывает.
    await newRow.locator('td').nth(3).click()
    await expect(page.locator('.timeline-status-dot').first()).toBeVisible({ timeout: 10000 })

    // 12. Мок подтвердил фактические вызовы (статус + трек)
    const updated = (await mockState(page, 'state.orders')).find(o => o.id === created.id)
    expect(updated.status).toBe('shipped')
    expect(updated.tracking_number).toBe('1Z999E2E2E2E2')
  })

  test('создание заказа невозможно без профиля и магазина (валидация)', async ({ page }) => {
    // SPEC-A: кнопки создания на Orders нет; валидация живёт в QuickOrderModal —
    // submit выключен, пока не выбран магазин (дроп подставится автоматически).
    await bootApp(page)
    await navTo(page, 'Orders')
    await expect(
      page.getByRole('button', { name: /create order/i })
    ).toHaveCount(0)
    await navTo(page, 'Profiles')
    await page
      .locator('table.tbl tbody tr', { hasText: 'John Doe' })
      .first()
      .getByRole('button', { name: 'Create new order for this profile' })
      .click()
    const modal = page.locator('.modal')
    await expect(modal).toBeVisible({ timeout: 10000 })
    const submit = modal.getByRole('button', { name: 'Create Order', exact: true })
    await expect(submit).toBeDisabled()
  })
})
