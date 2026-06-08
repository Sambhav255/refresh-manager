import { BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { getDb } from '../db/index.js'
import { requireStaffOrOwner } from '../session.js'
import { formatShortDate, formatTime } from './utils.js'

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

export function registerTicketHandlers() {
  ipcMain.handle(
    'tickets:print',
    wrap(async ({ transactionId, customerName, product, amount, paymentMethod, datetime }) => {
      requireStaffOrOwner()

      const payLabel = paymentMethod?.toLowerCase() === 'qr' ? 'QR' : 'Cash'
      const payment = amount != null ? `${payLabel} · Rs. ${amount}` : payLabel
      const dt = datetime || new Date().toISOString()
      const datePart = dt.includes('T') ? dt.slice(0, 10) : dt.slice(0, 10)
      const timePart = formatTime(dt.replace('T', ' ').slice(0, 19))

      const params = new URLSearchParams({
        id: String(transactionId || ''),
        customerName: customerName || '',
        product: product || '',
        date: formatShortDate(datePart),
        time: timePart,
        payment,
        address: getSetting('business_address', 'Nayabasti, Boudha, Kathmandu'),
        phone: getSetting('business_phone', '+977 9801010422')
      })

      const ticketWindow = new BrowserWindow({
        show: false,
        webPreferences: {
          sandbox: true
        }
      })

      const ticketHtml = is.dev
        ? join(__dirname, '../../src/renderer/ticket.html')
        : join(__dirname, '../renderer/ticket.html')

      await ticketWindow.loadFile(ticketHtml, {
        search: params.toString()
      })

      return new Promise((resolve) => {
        ticketWindow.webContents.print(
          { silent: true, printBackground: true },
          (success, failureReason) => {
            ticketWindow.close()
            if (success) {
              resolve({ success: true })
            } else {
              resolve({
                success: false,
                error: failureReason || 'No printer connected. Check printer in Settings.'
              })
            }
          }
        )
      })
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
