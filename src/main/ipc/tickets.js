import { BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { getDb } from '../db/index.js'
import { requireStaffOrOwner } from '../session.js'
import { formatShortDate, formatTime } from './utils.js'
import { normalizeKitchenItems } from '../kitchen-ticket-format.js'

function wrap(handler) {
  return async (_event, payload) => {
    try {
      return await handler(payload || {})
    } catch (err) {
      return { success: false, error: err.message }
    }
  }
}

function getSetting(key, fallback = '') {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key)
  return row?.value || fallback
}

async function printHiddenHtml(ticketHtml, params, opts) {
  const ticketWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true
    }
  })

  await ticketWindow.loadFile(ticketHtml, {
    search: params.toString()
  })

  return new Promise((resolve) => {
    ticketWindow.webContents.print(opts, (success, failureReason) => {
      ticketWindow.close()
      if (success) {
        resolve({ success: true })
      } else {
        resolve({
          success: false,
          error: failureReason || 'No printer connected. Check printer in Settings.'
        })
      }
    })
  })
}

// 3-D: reception desks commonly use 58mm / 80mm thermal roll printers. Build
// the print options and the ticket page width from settings. Untested against
// physical hardware — verify on the actual printer and tune height if a roll
// printer feeds blank paper after the receipt.
function receiptPrintOptions() {
  const width = getSetting('receipt_width', '80') // '58' | '80' | 'a4'
  const deviceName = getSetting('receipt_printer', '') // empty ⇒ default printer
  const silent = getSetting('receipt_silent', 'true') !== 'false'
  const opts = { silent, printBackground: true }
  if (deviceName) opts.deviceName = deviceName
  if (width === 'a4') {
    opts.pageSize = 'A4'
  } else {
    const mm = width === '58' ? 58 : 80
    opts.margins = { marginType: 'none' }
    // microns; height generous so long tickets aren't clipped (roll printers
    // cut at content). Tune per printer if needed.
    opts.pageSize = { width: Math.round(mm * 1000), height: Math.round(297 * 1000) }
  }
  return { opts, width }
}

export function registerTicketHandlers() {
  ipcMain.handle(
    'tickets:print',
    wrap(async ({ transactionId, customerName, product, amount, paymentMethod, datetime }) => {
      requireStaffOrOwner()

      const payLabel = paymentMethod?.toLowerCase() === 'qr' ? 'QR' : 'Cash'
      const payment = amount != null ? `${payLabel} · Rs. ${amount}` : payLabel
      // Local time, like every other timestamp in the app. This used to fall
      // back to toISOString() — UTC — and the fallback always ran because no
      // caller passed a datetime, so a receipt printed at 2:30pm in Kathmandu
      // printed 8:45am and disagreed with the log, the reports and the database.
      const dt = datetime || getDb().prepare(`SELECT datetime('now','localtime') AS n`).get().n
      const datePart = dt.includes('T') ? dt.slice(0, 10) : dt.slice(0, 10)
      const timePart = formatTime(dt.replace('T', ' ').slice(0, 19))

      const { opts, width } = receiptPrintOptions()
      const params = new URLSearchParams({
        id: String(transactionId || ''),
        customerName: customerName || '',
        product: product || '',
        date: formatShortDate(datePart),
        time: timePart,
        payment,
        w: width,
        address: getSetting('business_address', 'Nayabasti, Boudha, Kathmandu'),
        phone: getSetting('business_phone', '+977 9801010422')
      })

      const ticketHtml = is.dev
        ? join(__dirname, '../../src/renderer/ticket.html')
        : join(__dirname, '../renderer/ticket.html')

      return printHiddenHtml(ticketHtml, params, opts)
    })
  )


  ipcMain.handle(
    'tickets:print-kitchen',
    wrap(async ({ transactionId, customerName, items, datetime }) => {
      requireStaffOrOwner()

      const kitchenItems = normalizeKitchenItems(items)
      const dt = datetime || getDb().prepare(`SELECT datetime('now','localtime') AS n`).get().n
      const datePart = dt.includes('T') ? dt.slice(0, 10) : dt.slice(0, 10)
      const timePart = formatTime(dt.replace('T', ' ').slice(0, 19))

      const { opts, width } = receiptPrintOptions()
      const params = new URLSearchParams({
        id: String(transactionId || ''),
        customerName: customerName || '',
        date: formatShortDate(datePart),
        time: timePart,
        w: width,
        address: getSetting('business_address', 'Nayabasti, Boudha, Kathmandu'),
        items: JSON.stringify(kitchenItems)
      })

      const ticketHtml = is.dev
        ? join(__dirname, '../../src/renderer/kitchen-ticket.html')
        : join(__dirname, '../renderer/kitchen-ticket.html')

      return printHiddenHtml(ticketHtml, params, opts)
    })
  )

  ipcMain.handle(
    'tickets:print-membership-card',
    wrap(async ({ memberId, memberName, productName, startDate, endDate, photoPath }) => {
      requireStaffOrOwner()

      const params = new URLSearchParams({
        memberId: String(memberId || ''),
        memberName: memberName || '',
        productName: productName || '',
        startDate: startDate || '',
        endDate: endDate || '',
        photoPath: photoPath || '',
        businessName: getSetting('business_name', 'Refresh Recreation Center'),
        address: getSetting('business_address', 'Nayabasti, Boudha, Kathmandu')
      })

      const cardWindow = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true }
      })

      const cardHtml = is.dev
        ? join(__dirname, '../../src/renderer/membership-card.html')
        : join(__dirname, '../renderer/membership-card.html')

      await cardWindow.loadFile(cardHtml, { search: params.toString() })

      return new Promise((resolve) => {
        cardWindow.webContents.print(
          { silent: true, printBackground: true },
          (success, failureReason) => {
            cardWindow.close()
            if (success) resolve({ success: true })
            else resolve({ success: false, error: failureReason || 'Print failed' })
          }
        )
      })
    })
  )
}
