// @ts-check
import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { bootApp, navTo, mockState, mockCommands } from './helpers.js'

// TEST-004: импорт/экспорт. Контракты, что проверяем:
//   Cards export  — export_cards (маска ****last4, CVV не выгружается — FIX CRIT-02
//                   в _cards.rs): CSV с заголовком через ',', TXT без заголовка через '|',
//                   скачивание как cards_export.csv|txt.
//   Orders import — BatchImportModal (только файл): клиентский парсер
//                   profile_id,shop_id,item_name,item_sku,amount; создание чанками
//                   через batch_create_orders → { created, failed } (числа).
// NB: импорт карт удалён (MGR-018, этап B) — карты приходят срезами от менеджера.
const dialog = p => p.locator('[role="dialog"]')

test.describe('TEST-004: Экспорт карт (export_cards)', () => {
  test.beforeEach(async ({ page }) => {
    await bootApp(page)
    await navTo(page, 'Cards')
  })

  async function selectRow(page, text) {
    const row = page.locator('table.tbl tbody tr', { hasText: text }).first()
    await expect(row).toBeVisible({ timeout: 20000 })
    // чекбокс закрыт td-обработчиком — нативный клик по input (как в cards.spec.js)
    await row.locator('input[type="checkbox"]').evaluate(el => el.click())
  }

  test('Export CSV: имя cards_export.csv, заголовок, номер маскирован, CVV отсутствует', async ({ page }) => {
    await selectRow(page, '1111')
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ])
    expect(download.suggestedFilename()).toBe('cards_export.csv')

    const content = await readFile(await download.path(), 'utf8')
    expect(content).toContain('card_number,expiry_date,holder_name,email,phone,billing_address,city,state,country,zip')
    expect(content).toContain('****1111,12/28,John Doe')
    expect(content).not.toContain('4111111111111111')
    expect(content).not.toMatch(/,123[,|\n]/)
  })

  test('Export TXT: имя cards_export.txt, без CSV-заголовка, разделитель |', async ({ page }) => {
    await selectRow(page, '1111')
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export TXT' }).click(),
    ])
    expect(download.suggestedFilename()).toBe('cards_export.txt')

    const content = await readFile(await download.path(), 'utf8')
    expect(content).not.toContain('card_number,expiry_date')
    expect(content).toContain('****1111|12/28|John Doe')
    expect(content).not.toContain('4111111111111111')
  })

  test('выборочный экспорт: обе выделенные карты в файле', async ({ page }) => {
    await selectRow(page, '1111')
    await selectRow(page, '2222')
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ])
    const content = await readFile(await download.path(), 'utf8')
    expect(content).toContain('****1111,')
    expect(content).toContain('****2222,')
    // заголовок + ровно 2 строки данных
    expect(content.trim().split('\n')).toHaveLength(3)
  })
})

test.describe('TEST-004: Батч-импорт заказов (BatchImportModal)', () => {
  test.beforeEach(async ({ page }) => {
    await bootApp(page)
    await navTo(page, 'Orders')
    await page.getByRole('button', { name: 'Batch Import' }).click()
    await expect(dialog(page)).toContainText('Batch Import Orders')
  })

  test('валидный CSV: parsed 2 → Create 2 Orders → Created 2, ORD-2001/ORD-2002 в списке', async ({ page }) => {
    await dialog(page).locator('input[type="file"]').setInputFiles({
      name: 'orders.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'profile_id,shop_id,item_name,item_sku,amount\n' +
          'p1,1,Widget,W-1,9.99\n' +
          'p1,1,Gadget,G-2,19.99\n'
      ),
    })
    // текст склеен без пробела: <strong>2</strong>valid rows… — регэкспом
    await expect(dialog(page)).toContainText(/2\s*valid rows parsed from orders\.csv/)

    await dialog(page).getByRole('button', { name: 'Create 2 Orders' }).click()
    await expect(dialog(page)).toContainText('Done')
    const orders = await mockState(page, 'state.orders')
    expect(orders).toHaveLength(4)

    await dialog(page).getByRole('button', { name: 'Done' }).click()
    await expect(dialog(page)).toHaveCount(0)
    await expect(page.locator('table.tbl tbody tr', { hasText: 'ORD-2001' })).toHaveCount(1, { timeout: 20000 })
    await expect(page.locator('table.tbl tbody tr', { hasText: 'ORD-2002' })).toHaveCount(1)
  })

  test('строки без profile_id/shop_id отфильтрованы: Create задизейблен, команда не вызывается', async ({ page }) => {
    await dialog(page).locator('input[type="file"]').setInputFiles({
      name: 'orders.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('profile_id,shop_id,item_name,item_sku,amount\n,1,Widget,W-1,9.99\np2,0,Gadget,G-2,1\n'),
    })
    await expect(dialog(page)).not.toContainText('valid rows parsed')

    const create = dialog(page).getByRole('button', { name: 'Create' })
    await expect(create).toBeDisabled()
    const cmds = await mockCommands(page)
    expect(cmds).not.toContain('batch_create_orders')
  })
})
