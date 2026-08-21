import { useState, useEffect, useRef } from 'react'
import { api } from '../lib/api'
import { fmt, todayLocal } from '../lib/format'
import { Avatar, Badge, Icon } from '../components/ui'
import {
  CART_CATEGORIES,
  CATEGORY_HINTS,
  CATEGORY_LABELS,
  categoryLabel
} from '../../../shared/transaction-types'

// The owner asked for the member photo to go: "we can remove the member photo
// option because we essentially never gonna upload". It is hidden, not deleted —
// PhotoCapture, the camera handlers and the savePhoto call below are all still
// wired, so flipping this one flag brings the whole step back.
const FEATURES = { memberPhoto: false }

// Reception picks a category, not a database string. Tickets first: they are
// most of the day's sales, and the dropdown's first option is the default.
const SELL_CATEGORIES = [...CART_CATEGORIES, 'membership']
const UI_TYPES = SELL_CATEGORIES.map((c) => CATEGORY_LABELS[c])
const LABEL_TO_CATEGORY = Object.fromEntries(SELL_CATEGORIES.map((c) => [CATEGORY_LABELS[c], c]))

const CART_STEP_LABELS = ['Type', 'Items', 'Customer', 'Payment', 'Confirm']
const MEMBER_STEP_LABELS = ['Type', 'Plan', 'Customer', 'Payment', 'Confirm']

const MAX_LINE_QUANTITY = 999

// StepBar and PhotoCapture live at module scope: defining them inside
// NewTransaction gave them a new identity on every keystroke, so React
// remounted them per character — the step bar blinked and the camera
// <video> element was torn down mid-preview.
function StepBar({ step, labels }) {
  return (
    <div className="steps">
      {labels.map((l, i) => (
        <div key={l} className={'step ' + (i < step ? 'done' : i === step ? 'active' : '')}>
          {i < step && (
            <Icon name="check" size={10} style={{ marginRight: 3, verticalAlign: '-1px' }} />
          )}
          {l}
        </div>
      ))}
    </div>
  )
}

function PhotoCapture({
  photoPreview,
  cameraOn,
  videoRef,
  fileRef,
  onStartCamera,
  onStopCamera,
  onCapture,
  onClear,
  onFilePhoto
}) {
  return (
    <div
      style={{
        marginTop: 12,
        padding: 12,
        background: '#f8fafc',
        borderRadius: 8,
        border: '1px solid var(--border)'
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 500, color: '#64748b', marginBottom: 8 }}>
        Member photo (optional)
      </div>
      {photoPreview ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img
            src={photoPreview}
            alt="Member"
            style={{ width: 72, height: 72, borderRadius: 8, objectFit: 'cover' }}
          />
          <button
            className="btn btn-ghost"
            style={{ padding: '6px 10px', fontSize: 12 }}
            onClick={onClear}
          >
            Remove photo
          </button>
        </div>
      ) : cameraOn ? (
        <div>
          <video
            ref={videoRef}
            style={{ width: '100%', maxWidth: 280, borderRadius: 8, background: '#000' }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              className="btn btn-primary"
              style={{ padding: '6px 12px', fontSize: 12 }}
              onClick={onCapture}
            >
              Capture
            </button>
            <button
              className="btn btn-ghost"
              style={{ padding: '6px 12px', fontSize: 12 }}
              onClick={onStopCamera}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn btn-ghost"
            style={{ padding: '6px 12px', fontSize: 12 }}
            onClick={onStartCamera}
          >
            <Icon name="camera" size={14} /> Take photo
          </button>
          <button
            className="btn btn-ghost"
            style={{ padding: '6px 12px', fontSize: 12 }}
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="upload" size={14} /> Upload
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="user"
            style={{ display: 'none' }}
            onChange={onFilePhoto}
          />
        </div>
      )}
    </div>
  )
}

function groupProducts(products, counts = {}) {
  const grouped = {}
  for (const c of SELL_CATEGORIES) grouped[c] = []
  for (const p of products) {
    if (!grouped[p.category]) grouped[p.category] = []
    grouped[p.category].push(p)
  }
  // Most-sold first (last 60 days), then by name, so staff see the products
  // they actually pick at the top of the list.
  for (const c of Object.keys(grouped)) {
    grouped[c].sort(
      (a, b) =>
        (counts[b.id] || 0) - (counts[a.id] || 0) ||
        (a.displayName || a.name).localeCompare(b.displayName || b.name)
    )
  }
  return grouped
}

// The renderer's own copy of the duration wording, so the two-step membership
// picker can split "Gym Only — Monthly" back into a plan and a length. Matches
// formatDurationLabel in the main process; a duration it does not know still
// reads sensibly as a number of days.
function durationLabel(days) {
  if (days == null) return ''
  if (days === 15) return '15 Days'
  if (days === 30) return 'Monthly'
  if (days === 90) return '3 Months'
  if (days === 180) return '6 Months'
  if (days === 365) return '1 Year'
  return `${days} Days`
}

function poolItemLabel(item) {
  return item.variant && item.variant !== '—' ? `${item.name} (${item.variant})` : item.name
}

let nextLineUid = 1

function productLine(product) {
  return {
    uid: nextLineUid++,
    kind: 'product',
    refId: product.id,
    name: product.displayName || product.name,
    // Adult is the everyday case; the toggle on the line switches it and the
    // quote comes back with the child rate the owner set.
    tier: 'adult',
    quantity: 1,
    discount: '',
    discountReason: '',
    showDiscount: false
  }
}

function poolLine(item) {
  return {
    uid: nextLineUid++,
    kind: 'pool_item',
    refId: item.id,
    name: poolItemLabel(item),
    // Tier pricing is a property of a product price rule; the engine throws if
    // a goggles line carries one.
    tier: null,
    quantity: 1,
    discount: '',
    discountReason: '',
    showDiscount: false
  }
}

// What the engine is actually asked to price. No unit price, no line total and
// no staff id: the till decides what things cost. A discount with no reason is
// left off rather than sent — the handler would refuse the whole sale, and the
// basket says so on the line instead (see discountsNeedReason).
// Lets the global App.jsx Escape-to-logout handler know whether there is an
// in-progress, unsaved cart right now, without a larger cross-component
// refactor. Kept as a module-level mutable flag rather than context/redux
// because it only needs to answer one yes/no question for one consumer.
export const cartGuard = { hasItems: false }

function cartPayload(cart) {
  return cart.map((l) => {
    const entry = { kind: l.kind, refId: l.refId, quantity: l.quantity }
    if (l.kind === 'product' && l.tier) entry.tier = l.tier
    const discount = Number(l.discount)
    if (discount > 0 && l.discountReason.trim()) {
      entry.discount = discount
      entry.discountReason = l.discountReason.trim()
    }
    return entry
  })
}

function discountsNeedReason(cart) {
  return cart.some((l) => Number(l.discount) > 0 && !l.discountReason.trim())
}

// No `session` prop any more: the sale handlers take the staff id from the
// signed-in session in the main process, so the till has nothing to tell them.
export function NewTransaction({ onDone }) {
  const [step, setStep] = useState(0)
  const [type, setType] = useState(UI_TYPES[0])
  // Membership only: the plan (a product name) and then the duration variant of
  // it. Day passes and packages are basket lines instead.
  const [plan, setPlan] = useState('')
  const [productId, setProductId] = useState('')
  const [cart, setCart] = useState([])
  const [quote, setQuote] = useState(null)
  const [quoteError, setQuoteError] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [pay, setPay] = useState('Cash')
  // 'full' pays the lot now; 'part' takes a deposit and leaves a balance; 'later'
  // collects nothing at all, which has to be a deliberate choice, never a slip.
  const [payMode, setPayMode] = useState('full')
  const [partAmount, setPartAmount] = useState('')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [products, setProducts] = useState([])
  const [poolItems, setPoolItems] = useState([])
  const [grouped, setGrouped] = useState({})
  const [popularity, setPopularity] = useState({})
  const [savedTxn, setSavedTxn] = useState(null)
  // People already on file who look like this customer. Non-empty only while
  // reception is being asked which of them (if any) this sale belongs to.
  const [matches, setMatches] = useState([])
  const [savingChoice, setSavingChoice] = useState(null)
  const [printError, setPrintError] = useState(null)
  const [cardPrinted, setCardPrinted] = useState(false)
  // Ticket and card print separately so a slow printer on one never blocks the
  // other button, and so a press is visibly doing something before it returns.
  const [printingTicket, setPrintingTicket] = useState(false)
  const [ticketPrinted, setTicketPrinted] = useState(false)
  const [printingCard, setPrintingCard] = useState(false)
  const [loadingProducts, setLoadingProducts] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [photoPreview, setPhotoPreview] = useState(null)
  const [photoBase64, setPhotoBase64] = useState(null)
  const [cameraOn, setCameraOn] = useState(false)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const fileRef = useRef(null)
  // Tracks whether the staff member built the basket (or picked a plan)
  // themselves, so the popularity preselect never overrides a choice they made.
  const userPickedProductRef = useRef(false)
  // Quotes are one local sqlite read, but they can still land out of order when
  // a finger holds down "+". Only the newest reply is allowed to set the total.
  const quoteSeqRef = useRef(0)

  const category = LABEL_TO_CATEGORY[type]
  const isMembership = category === 'membership'

  // Keep the module-level cartGuard in sync: unsaved once the basket has
  // lines, no longer unsaved once the sale has actually gone through.
  useEffect(() => {
    cartGuard.hasItems = cart.length > 0 && !saved
  }, [cart, saved])

  // Belt and braces: if this screen unmounts for any other reason (nav away,
  // error boundary) the guard must not be left stuck "true" forever.
  useEffect(() => {
    return () => {
      cartGuard.hasItems = false
    }
  }, [])

  useEffect(() => {
    Promise.all([api.listProducts(), api.productPopularity(), api.listPoolInventory()])
      .then(([r, pop, inv]) => {
        const list = r.products || []
        const counts = {}
        for (const c of pop.counts || []) counts[c.productId] = c.count
        setProducts(list)
        setPopularity(counts)
        setGrouped(groupProducts(list, counts))
        // Only what can actually be sold as an add-on: in stock, priced, live.
        setPoolItems((inv.items || []).filter((i) => i.isActive && i.price > 0))
        setLoadingProducts(false)
      })
      // A failed catalogue load used to leave an empty product dropdown with no
      // explanation, so the till looked broken rather than temporarily stuck.
      .catch(() => {
        setLoadingProducts(false)
        setLoadError('Could not load the product list. Leave this screen and open it again.')
      })
  }, [])

  useEffect(() => {
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop())
    }
  }, [])

  // The running total comes from the engine, never from arithmetic here: it is
  // the same code path checkout will use, so what reception reads out to the
  // customer is what the till is about to charge — tiers, Saturday rates and all.
  useEffect(() => {
    if (isMembership || cart.length === 0) {
      setQuote(null)
      setQuoteError('')
      return
    }
    const seq = ++quoteSeqRef.current
    api.quoteSale({ cart: cartPayload(cart) }).then((r) => {
      if (seq !== quoteSeqRef.current) return
      if (!r || r.success === false) {
        setQuoteError(r?.error || 'Could not price this basket')
        return
      }
      setQuoteError('')
      setQuote(r)
    })
  }, [cart, isMembership])

  const membershipProduct = products.find((p) => String(p.id) === String(productId))
  const membershipPlans = [...new Set((grouped.membership || []).map((p) => p.name))]
  const planDurations = (grouped.membership || [])
    .filter((p) => p.name === plan)
    .sort((a, b) => (a.duration_days || 0) - (b.duration_days || 0))

  const total = isMembership ? (membershipProduct?.price ?? 0) : (quote?.total ?? 0)
  const partPaid = Number(partAmount) || 0
  const paidNow = isMembership || payMode === 'full' ? total : payMode === 'part' ? partPaid : 0
  const balance = Math.round((total - paidNow) * 100) / 100
  const needsReason = discountsNeedReason(cart)
  // Guarded on !isMembership because the part-payment controls only render for
  // a cart sale. Without it, choosing "Part payment" and then going Back and
  // switching the type to Membership left payMode stuck at 'part' with an empty
  // amount: Continue stayed disabled at the Payment step with nothing on screen
  // to put right, and the only way out was abandoning the sale.
  const partAmountInvalid =
    !isMembership && payMode === 'part' && !(partPaid > 0 && partPaid <= total)

  const allPricesZero = products.length > 0 && products.every((p) => !p.price)
  // The all-zero banner never fires in the realistic case: the owner priced
  // most products and missed one. Warn on what is actually being SOLD instead,
  // so a Rs. 0 sale cannot be written without the staff member seeing it.
  const unpricedNames = isMembership
    ? membershipProduct && !(membershipProduct.price > 0)
      ? [membershipProduct.displayName || membershipProduct.name]
      : []
    : (quote?.lines || []).filter((l) => !(l.unitPrice > 0)).map((l) => l.description)

  const setPhotoFromDataUrl = (dataUrl) => {
    setPhotoPreview(dataUrl)
    setPhotoBase64(dataUrl)
  }

  const handleFilePhoto = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setPhotoFromDataUrl(reader.result)
    reader.readAsDataURL(file)
  }

  const startCamera = async () => {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false
      })
      streamRef.current = stream
      setCameraOn(true)
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play()
        }
      }, 50)
    } catch {
      setError('Could not access camera. Try uploading a photo instead.')
    }
  }

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setCameraOn(false)
  }

  const capturePhoto = () => {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 320
    canvas.height = video.videoHeight || 240
    canvas.getContext('2d').drawImage(video, 0, 0)
    setPhotoFromDataUrl(canvas.toDataURL('image/jpeg', 0.85))
    stopCamera()
  }

  const clearPhoto = () => {
    setPhotoPreview(null)
    setPhotoBase64(null)
    stopCamera()
    if (fileRef.current) fileRef.current.value = ''
  }

  // ---- basket ------------------------------------------------------------
  const editLine = (uid, patch) => {
    userPickedProductRef.current = true
    setCart((c) => c.map((l) => (l.uid === uid ? { ...l, ...patch } : l)))
  }
  const addLine = (line) => {
    userPickedProductRef.current = true
    setCart((c) => [...c, line])
  }
  const removeLine = (uid) => {
    userPickedProductRef.current = true
    setCart((c) => c.filter((l) => l.uid !== uid))
  }
  const bumpQuantity = (uid, delta) => {
    userPickedProductRef.current = true
    setCart((c) =>
      c.map((l) =>
        l.uid === uid
          ? { ...l, quantity: Math.min(MAX_LINE_QUANTITY, Math.max(1, l.quantity + delta)) }
          : l
      )
    )
  }

  // Writes the sale. `existing` is a member picked from the match list, or null
  // to mint a new one. Member row, membership and money move in one transaction
  // now: the old create-then-add pair forked a returning customer into a second
  // record, and left an orphaned member behind whenever the second call failed.
  const saveMembership = async (existing) => {
    setSaving(true)
    setSavingChoice(existing ? existing.id : 'new')
    setError('')

    // Amount and staff id are deliberately not sent: the handler takes the
    // price from the catalogue and the staff id from the session.
    const result = await api.createMemberWithMembership({
      memberId: existing?.id,
      name: name.trim(),
      phone: phone || null,
      productId: membershipProduct?.id,
      startDate: todayLocal(),
      paymentMethod: pay.toLowerCase()
    })
    if (result?.success === false) {
      setSaving(false)
      setSavingChoice(null)
      setError(result.error || 'Failed to save membership')
      return
    }

    // The photo needs a member id, so it lands after the sale — a failed upload
    // must not cost the customer their membership.
    let photoPath = existing?.photoPath || null
    if (photoBase64) {
      const photoResult = await api.savePhoto({ memberId: result.memberId, base64: photoBase64 })
      if (photoResult?.success !== false) photoPath = photoResult.photoPath
    }

    setSaving(false)
    setSavingChoice(null)
    setMatches([])
    setSavedTxn({
      transactionId: result.transactionId,
      product: membershipProduct?.displayName || membershipProduct?.name || productId,
      amount: total,
      paid: total,
      balance: 0,
      pay,
      isMembership: true,
      memberId: result.memberId,
      // The card carries the name the record is filed under, so a renewal
      // typed in with different spelling still prints as that member.
      memberName: existing?.name || name.trim(),
      // Dates come back from the write: the card must print the days the
      // database actually granted, not a second guess at them.
      startDate: result.startDate,
      endDate: result.endDate,
      photoPath
    })
    setSaved(true)
  }

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    setError('')

    if (isMembership) {
      if (!name.trim()) {
        setError('Member name is required for memberships')
        setSaving(false)
        return
      }
      // Ask before writing, but only when there is something to ask about: with
      // no match this is one local query and the sale saves as it always did.
      const lookup = await api.findMemberMatches({ name: name.trim(), phone: phone || null })
      if (lookup?.success === false) {
        // Usually a malformed phone, which the write would reject on the same
        // value — say so here rather than after taking the customer's money.
        setSaving(false)
        setError(lookup.error || 'Could not check for an existing member')
        return
      }
      if (lookup?.matches?.length) {
        setSaving(false)
        setMatches(lookup.matches)
        return
      }
      await saveMembership(null)
      return
    }

    // Belt and braces: the basket step already blocks Continue on this, but a
    // discount that reached the handler without a reason would fail the whole
    // sale in front of a paying customer.
    if (needsReason) {
      setSaving(false)
      setError('Every discount needs a reason before the sale can be saved')
      return
    }

    // Neither prices nor staff id are sent — see cartPayload. The payment shape
    // is the whole difference between paid, part-paid and on account.
    const payment =
      payMode === 'full'
        ? { paymentMethod: pay.toLowerCase() }
        : payMode === 'part'
          ? { payments: [{ amount: partPaid, method: pay.toLowerCase() }] }
          : { payments: [] }

    const result = await api.createSale({
      customerName: name.trim() || undefined,
      phone: phone || null,
      cart: cartPayload(cart),
      ...payment
    })
    setSaving(false)
    if (result?.success === false) {
      setError(result.error || 'Failed to save transaction')
      return
    }
    setSavedTxn({
      transactionId: result.transactionId,
      product: cart.map((l) => `${l.name} ×${l.quantity}`).join(', '),
      amount: result.total,
      paid: result.paid,
      balance: result.balance,
      pay: payMode === 'later' ? 'Unpaid' : pay,
      isMembership: false
    })
    setSaved(true)
  }

  const handlePrint = async () => {
    if (!savedTxn || printingTicket) return
    setPrintError(null)
    setTicketPrinted(false)
    setPrintingTicket(true)
    const result = await api.printTicket({
      transactionId: savedTxn.transactionId,
      customerName: name || 'Walk-in',
      product: savedTxn.product,
      amount: savedTxn.amount,
      paymentMethod: savedTxn.pay
    })
    setPrintingTicket(false)
    if (!result?.success) {
      setPrintError('No printer found. Check the printer is on and connected, then try again.')
      return
    }
    // A successful ticket print used to look identical to a dead button:
    // nothing on screen changed, so staff pressed it again and again.
    setTicketPrinted(true)
  }

  const handlePrintCard = async () => {
    if (!savedTxn?.isMembership || printingCard) return
    // Mirrors handlePrint: the result used to be discarded, so a failed card
    // print was indistinguishable from a successful one — nothing happened.
    setPrintError(null)
    setCardPrinted(false)
    setPrintingCard(true)
    const result = await api.printMembershipCard({
      memberId: savedTxn.memberId,
      memberName: savedTxn.memberName,
      productName: savedTxn.product,
      startDate: savedTxn.startDate,
      endDate: savedTxn.endDate,
      photoPath: savedTxn.photoPath || ''
    })
    setPrintingCard(false)
    if (!result?.success) {
      setPrintError('No printer found. Check the printer is on and connected, then try again.')
      return
    }
    setCardPrinted(true)
  }

  const reset = () => {
    setSaved(false)
    setSavedTxn(null)
    setMatches([])
    setSavingChoice(null)
    setStep(0)
    setType(UI_TYPES[0])
    setPlan('')
    setProductId('')
    setCart([])
    setQuote(null)
    setQuoteError('')
    setPayMode('full')
    setPartAmount('')
    userPickedProductRef.current = false
    setName('')
    setPhone('')
    setError('')
    setPrintError(null)
    setTicketPrinted(false)
    setCardPrinted(false)
    clearPhoto()
  }

  if (saved) {
    return (
      <div className="content fade-in" style={{ display: 'grid', placeItems: 'center' }}>
        <div
          className="card scale-in"
          style={{ width: 420, padding: '34px 28px', textAlign: 'center' }}
        >
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: '50%',
              background: '#dcfce7',
              display: 'grid',
              placeItems: 'center',
              margin: '0 auto 16px'
            }}
          >
            <Icon name="check" size={30} color="#16a34a" />
          </div>
          <div style={{ fontSize: 17, fontWeight: 500 }}>Transaction saved</div>
          <div className="sub" style={{ marginTop: 6 }}>
            {savedTxn?.product} · {fmt(savedTxn?.amount)} · {savedTxn?.pay}
          </div>
          {savedTxn?.balance > 0 && (
            <div className="alert amber" style={{ marginTop: 14, textAlign: 'left' }}>
              <Icon name="alert-triangle" size={17} />
              <div>
                <div className="a-title">{fmt(savedTxn.balance)} still to collect</div>
                <div className="a-desc">
                  Paid now {fmt(savedTxn.paid)} of {fmt(savedTxn.amount)}. The balance is on the
                  customer&apos;s record until it is taken.
                </div>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 22, flexDirection: 'column' }}>
            <button
              className="btn btn-ghost btn-block"
              disabled={printingTicket}
              onClick={handlePrint}
            >
              <Icon name="printer" size={16} />{' '}
              {printingTicket
                ? 'Sending to printer…'
                : ticketPrinted
                  ? 'Ticket sent to printer ✓'
                  : 'Print Ticket'}
            </button>
            {savedTxn?.isMembership && (
              <button
                className="btn btn-ghost btn-block"
                disabled={printingCard}
                onClick={handlePrintCard}
              >
                <Icon name="credit-card" size={16} />{' '}
                {printingCard
                  ? 'Sending to printer…'
                  : cardPrinted
                    ? 'Card sent to printer ✓'
                    : 'Print membership card'}
              </button>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-ghost btn-block" onClick={reset}>
                New transaction
              </button>
              <button className="btn btn-primary btn-block" onClick={() => onDone('home')}>
                Done
              </button>
            </div>
            {printError && (
              <div className="alert amber" style={{ marginTop: 12 }}>
                {printError}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Someone on file already answers to this phone or name. The choice is
  // reception's, never the code's: a shared name is not proof of the same
  // person, and a renewal saved as a new customer is exactly what splits a
  // member's check-ins, photo and history across two records.
  if (matches.length > 0) {
    return (
      <div
        className="content fade-in"
        style={{ display: 'grid', placeItems: 'start center', paddingTop: 26 }}
      >
        <div className="card scale-in" style={{ width: 500, padding: 22 }}>
          <div style={{ fontSize: 16, fontWeight: 500 }}>
            {matches.length === 1 ? 'This customer may already be a member' : 'Possible matches'}
          </div>
          <p className="sub" style={{ marginTop: 6, marginBottom: 14 }}>
            Adding the membership to an existing record keeps their check-ins, photo and history in
            one place. If this is a different person, create a new member instead.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {matches.map((m) => {
              const mem = m.activeMembership
              const last = m.lastMembership
              const status = mem?.uiStatus || 'Expired'
              // What reception is asked next: "what were you on?" — a lapsed
              // member has no active row to answer it with.
              const history = mem
                ? `${mem.productName} · expires ${mem.endDisplay}`
                : last
                  ? `${last.productName} · ended ${last.endDisplay}`
                  : 'No membership on record'
              return (
                <div
                  key={m.id}
                  className="card"
                  style={{ padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 14 }}
                >
                  <Avatar initials={m.initials} status={status} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{m.name}</div>
                    <div className="sub" style={{ color: '#64748b', marginTop: 2 }}>
                      {m.phone || 'No phone'} · {history}
                    </div>
                    <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 2 }}>
                      {m.matchedOn === 'phone' ? 'Same phone number' : 'Same name'}
                    </div>
                  </div>
                  <div
                    style={{
                      textAlign: 'right',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      alignItems: 'flex-end'
                    }}
                  >
                    <Badge kind={status} />
                    <button
                      className="btn btn-primary"
                      style={{ padding: '5px 11px', fontSize: 12 }}
                      disabled={saving}
                      onClick={() => saveMembership(m)}
                    >
                      {savingChoice === m.id ? 'Saving…' : 'This is them'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          {error && (
            <div className="alert red" style={{ marginTop: 14 }}>
              <Icon name="alert-triangle" size={17} />
              <div className="a-desc">{error}</div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button
              className="btn btn-ghost"
              disabled={saving}
              onClick={() => {
                // Back to the wizard with the sale intact — the usual reason to
                // land here wrongly is a mistyped phone, which is fixable.
                setMatches([])
                setError('')
              }}
            >
              <Icon name="chevron-left" size={16} /> Back
            </button>
            <div className="spacer" />
            <button
              className="btn btn-ghost"
              disabled={saving}
              onClick={() => saveMembership(null)}
            >
              {savingChoice === 'new' ? 'Saving…' : 'None of these — new member'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Most-picked (last 60 days) active product of a category with a real price —
  // the options are already sorted by sales count, so the first match is the one
  // staff sell most. Used to preselect; staff can still change it freely.
  const mostPopular = (cat) =>
    (grouped[cat] || []).find((p) => p.is_active !== 0 && Number(p.price) > 0) || null

  // Entering a step with nothing chosen yet: put the most popular product of the
  // type in front of them. One adult entry ticket paid cash is then four
  // Continues and a Confirm — exactly what it cost before the basket existed.
  const preselect = (uiType) => {
    if (userPickedProductRef.current) return
    const cat = LABEL_TO_CATEGORY[uiType]
    const best = mostPopular(cat)
    if (cat === 'membership') {
      setPlan(best ? best.name : '')
      setProductId(best ? String(best.id) : '')
    } else {
      setCart(best ? [productLine(best)] : [])
    }
  }

  const next = () => {
    if (step === 0 && (isMembership ? !productId : cart.length === 0)) preselect(type)
    setStep((s) => Math.min(4, s + 1))
  }
  const back = () => setStep((s) => Math.max(0, s - 1))

  const stepLabels = isMembership ? MEMBER_STEP_LABELS : CART_STEP_LABELS
  // Add-ons sit next to whatever the customer came in for, so a ticket and a
  // pair of goggles is ONE sale and one receipt — the thing the owner said was
  // "not feasible with the setup we have right now".
  const sellableCategories = CART_CATEGORIES.filter((c) => (grouped[c] || []).length > 0)
  const nothingToSell = !loadingProducts && !loadError && sellableCategories.length === 0

  const continueDisabled =
    (step === 1 && isMembership && !productId) ||
    (step === 1 && !isMembership && (cart.length === 0 || needsReason || !!quoteError)) ||
    (step === 3 && partAmountInvalid)

  return (
    <div
      className="content fade-in"
      style={{ display: 'grid', placeItems: 'start center', paddingTop: 26 }}
    >
      <div className="card" style={{ width: 560, padding: 22 }}>
        {loadError && (
          <div className="alert red" style={{ marginBottom: 14 }}>
            <Icon name="alert-triangle" size={17} />
            <div className="a-desc">{loadError}</div>
          </div>
        )}
        {!allPricesZero && unpricedNames.length > 0 && (
          <div className="alert amber" style={{ marginBottom: 14 }}>
            <Icon name="alert-triangle" size={17} />
            <div>
              <div className="a-title">{unpricedNames.join(', ')} has no price set</div>
              <div className="a-desc">
                Saving now records a Rs. 0 line. Ask the owner to set its price in Settings →
                Pricing manager.
              </div>
            </div>
          </div>
        )}
        {allPricesZero && (
          <div className="alert amber" style={{ marginBottom: 14 }}>
            <Icon name="alert-triangle" size={17} />
            <div>
              <div className="a-title">All product prices are Rs. 0</div>
              <div className="a-desc">
                Ask the owner to set prices in Settings → Pricing manager.
              </div>
            </div>
          </div>
        )}
        <StepBar step={step} labels={stepLabels} />

        {step === 0 && (
          <div className="fade-in">
            <div className="field">
              <label>Transaction type</label>
              <select
                className="select"
                value={type}
                onChange={(e) => {
                  const t = e.target.value
                  setType(t)
                  // Switching type throws away an untouched preselect and picks
                  // the new type's most popular instead; a basket the staff
                  // member actually built is left alone.
                  if (LABEL_TO_CATEGORY[t] === 'membership') setCart([])
                  else {
                    setPlan('')
                    setProductId('')
                  }
                  preselect(t)
                }}
              >
                {UI_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <p className="sub" style={{ marginBottom: 4 }}>
              {CATEGORY_HINTS[category]}
            </p>
          </div>
        )}

        {step === 1 && isMembership && (
          <div className="fade-in">
            {/* Two questions instead of one long list of every plan × every
                length: "there's just too many things in a dropdown". */}
            <div className="field">
              <label>Membership type</label>
              <select
                className="select"
                value={plan}
                onChange={(e) => {
                  userPickedProductRef.current = true
                  const nextPlan = e.target.value
                  setPlan(nextPlan)
                  // One length offered means there is nothing to choose — pick it
                  // so the second question does not stall an obvious sale.
                  const durations = (grouped.membership || []).filter((p) => p.name === nextPlan)
                  setProductId(durations.length === 1 ? String(durations[0].id) : '')
                }}
              >
                <option value="">Select a membership…</option>
                {membershipPlans.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            {plan && (
              <div className="field fade-in">
                <label>How long</label>
                <select
                  className="select"
                  value={productId}
                  onChange={(e) => {
                    userPickedProductRef.current = true
                    setProductId(e.target.value)
                  }}
                >
                  <option value="">Select a duration…</option>
                  {planDurations.map((p) => (
                    <option key={p.id} value={p.id}>
                      {durationLabel(p.duration_days)} — {fmt(p.price)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {!loadingProducts && !loadError && membershipPlans.length === 0 && (
              <p className="sub" style={{ marginTop: 6 }}>
                No memberships are set up. Press Back to choose another type, or ask the owner to
                add one in Settings → Pricing manager.
              </p>
            )}
            {loadingProducts && (
              <p className="sub" style={{ marginTop: 6 }}>
                Loading products…
              </p>
            )}
            {productId && (
              <div className="amount-box">
                <span className="a-label">Amount</span>
                <span className="a-value">{fmt(total)}</span>
              </div>
            )}
          </div>
        )}

        {step === 1 && !isMembership && (
          <div className="fade-in">
            {cart.length === 0 && (
              <p className="sub" style={{ marginBottom: 12 }}>
                Nothing in the basket yet. Add a ticket below.
              </p>
            )}
            {cart.map((line, i) => {
              const priced = quote?.lines?.[i]
              const discount = Number(line.discount) || 0
              const reasonMissing = discount > 0 && !line.discountReason.trim()
              return (
                <div
                  key={line.uid}
                  className="cart-line"
                  style={{
                    padding: '10px 0',
                    borderBottom: '1px solid var(--border)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 500 }}>{line.name}</div>
                      {/* The unit price is on screen so staff can see WHY the
                          total is what it is — child rate, Saturday rate or the
                          plain catalogue price. */}
                      <div className="sub" style={{ marginTop: 2 }}>
                        {priced ? `${fmt(priced.unitPrice)} each` : 'Pricing…'}
                        {line.kind === 'pool_item' ? ' · add-on' : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <button
                        className="btn btn-ghost"
                        aria-label={`One less ${line.name}`}
                        style={{ padding: '4px 10px', fontSize: 15, lineHeight: 1 }}
                        disabled={line.quantity <= 1}
                        onClick={() => bumpQuantity(line.uid, -1)}
                      >
                        −
                      </button>
                      <span
                        style={{ minWidth: 24, textAlign: 'center', fontSize: 14, fontWeight: 500 }}
                      >
                        {line.quantity}
                      </span>
                      <button
                        className="btn btn-ghost"
                        aria-label={`One more ${line.name}`}
                        style={{ padding: '4px 10px', fontSize: 15, lineHeight: 1 }}
                        onClick={() => bumpQuantity(line.uid, 1)}
                      >
                        +
                      </button>
                    </div>
                    <div
                      style={{
                        minWidth: 84,
                        textAlign: 'right',
                        fontSize: 13.5,
                        fontWeight: 500
                      }}
                    >
                      {priced ? fmt(priced.lineTotal) : '—'}
                    </div>
                    <button
                      className="btn btn-ghost"
                      aria-label={`Remove ${line.name}`}
                      style={{ padding: '4px 9px', fontSize: 13, lineHeight: 1 }}
                      onClick={() => removeLine(line.uid)}
                    >
                      ✕
                    </button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7 }}>
                    {/* Tiers are a product price rule, so a goggles line has no
                        adult/child to choose. */}
                    {line.kind === 'product' && (
                      <div className="seg">
                        {['adult', 'child'].map((t) => (
                          <button
                            key={t}
                            className={line.tier === t ? 'on' : ''}
                            onClick={() => editLine(line.uid, { tier: t })}
                          >
                            {t === 'adult' ? 'Adult' : 'Child'}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="spacer" />
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '4px 9px', fontSize: 12 }}
                      onClick={() =>
                        editLine(line.uid, {
                          showDiscount: !line.showDiscount,
                          // Closing the panel drops the discount rather than
                          // leaving an invisible one applied to the sale.
                          ...(line.showDiscount ? { discount: '', discountReason: '' } : {})
                        })
                      }
                    >
                      <Icon name="tag" size={13} />{' '}
                      {line.showDiscount ? 'Cancel discount' : 'Discount'}
                    </button>
                  </div>
                  {line.showDiscount && (
                    <div className="fade-in" style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <input
                        className="input"
                        style={{ width: 120 }}
                        type="number"
                        min="0"
                        placeholder="Rs. off"
                        value={line.discount}
                        onChange={(e) => editLine(line.uid, { discount: e.target.value })}
                      />
                      <input
                        className="input"
                        style={{ flex: 1 }}
                        placeholder="Reason for the discount"
                        value={line.discountReason}
                        onChange={(e) => editLine(line.uid, { discountReason: e.target.value })}
                      />
                    </div>
                  )}
                  {/* The handler refuses a discount with no reason. Say so here,
                      while it can still be typed, rather than after the click. */}
                  {reasonMissing && (
                    <div className="sub" style={{ color: '#b91c1c', marginTop: 6 }}>
                      A reason is required before this discount can be applied.
                    </div>
                  )}
                </div>
              )
            })}

            <div style={{ marginTop: 14 }}>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>Add a ticket</label>
                <select
                  className="select"
                  value=""
                  onChange={(e) => {
                    const p = products.find((x) => String(x.id) === e.target.value)
                    if (p) addLine(productLine(p))
                    e.target.value = ''
                  }}
                >
                  <option value="">Add a ticket…</option>
                  {sellableCategories.map((c) => (
                    <optgroup key={c} label={categoryLabel(c)}>
                      {(grouped[c] || []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.displayName || p.name} — {fmt(p.price)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {Object.keys(popularity).length > 0 && (
                  <p className="sub" style={{ marginTop: 4 }}>
                    Most picked first
                  </p>
                )}
              </div>
              <div className="field" style={{ marginBottom: 6 }}>
                <label>Add goggles, caps or other pool items</label>
                <select
                  className="select"
                  value=""
                  onChange={(e) => {
                    const item = poolItems.find((x) => String(x.id) === e.target.value)
                    if (item) addLine(poolLine(item))
                    e.target.value = ''
                  }}
                >
                  <option value="">Add an item…</option>
                  {poolItems.map((it) => (
                    <option key={it.id} value={it.id} disabled={it.stock <= 0}>
                      {poolItemLabel(it)} — {fmt(it.price)}
                      {it.stock <= 0 ? ' (out of stock)' : ` · ${it.stock} left`}
                    </option>
                  ))}
                </select>
              </div>
              {poolItems.length === 0 && !loadingProducts && (
                <p className="sub">No priced pool items in stock to add.</p>
              )}
            </div>

            {nothingToSell && (
              <p className="sub" style={{ marginTop: 6 }}>
                No tickets are set up. Ask the owner to add one in Settings → Pricing manager.
              </p>
            )}
            {(quote?.shortfalls || []).map((s) => (
              <div className="alert amber" style={{ marginTop: 12 }} key={s.name}>
                <Icon name="alert-triangle" size={17} />
                <div className="a-desc">
                  {s.name}: only {s.available} left, the basket asks for {s.needed}.
                </div>
              </div>
            ))}
            {quoteError && (
              <div className="alert red" style={{ marginTop: 12 }}>
                <Icon name="alert-triangle" size={17} />
                <div className="a-desc">{quoteError}</div>
              </div>
            )}
            {cart.length > 0 && (
              <div className="amount-box" style={{ marginTop: 14 }}>
                <span className="a-label">Total</span>
                <span className="a-value">{fmt(total)}</span>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="fade-in">
            <div className="field">
              <label>{isMembership ? 'Membership' : 'Basket'}</label>
              <div className="amount-box" style={{ display: 'block' }}>
                {isMembership ? (
                  <div style={{ fontSize: 13 }}>
                    {membershipProduct?.displayName || membershipProduct?.name}
                  </div>
                ) : (
                  cart.map((l, i) => (
                    <div
                      key={l.uid}
                      style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}
                    >
                      <span>
                        {l.name} ×{l.quantity}
                      </span>
                      <span>{quote?.lines?.[i] ? fmt(quote.lines[i].lineTotal) : '—'}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="field">
              {/* A membership is filed under this name, so it is required; a
                  ticket saves as "Walk-in". Say which before the Confirm step,
                  not after the customer has been asked to pay. */}
              <label>
                {isMembership ? 'Customer name (required)' : 'Customer name (optional)'}
              </label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
              />
            </div>
            <div className="field">
              <label>Phone (optional)</label>
              <input
                className="input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="98XXXXXXXX"
              />
            </div>
            {FEATURES.memberPhoto && isMembership && (
              <PhotoCapture
                photoPreview={photoPreview}
                cameraOn={cameraOn}
                videoRef={videoRef}
                fileRef={fileRef}
                onStartCamera={startCamera}
                onStopCamera={stopCamera}
                onCapture={capturePhoto}
                onClear={clearPhoto}
                onFilePhoto={handleFilePhoto}
              />
            )}
            <div className="amount-box">
              <span className="a-label">Amount</span>
              <span className="a-value">{fmt(total)}</span>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="fade-in">
            <div className="amount-box" style={{ marginBottom: 16 }}>
              <span className="a-label">Amount due</span>
              <span className="a-value">{fmt(total)}</span>
            </div>
            {/* A membership is sold and paid in one go by the member handler, so
                it is not offered on account here. */}
            {!isMembership && (
              <div style={{ marginBottom: 16 }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: 12,
                    fontWeight: 500,
                    color: '#64748b',
                    marginBottom: 8
                  }}
                >
                  How much is being collected now
                </label>
                <div className="seg" style={{ display: 'flex', width: '100%' }}>
                  {[
                    ['full', 'Pay in full'],
                    ['part', 'Part payment'],
                    ['later', 'Nothing now']
                  ].map(([m, l]) => (
                    <button
                      key={m}
                      style={{ flex: 1 }}
                      className={payMode === m ? 'on' : ''}
                      onClick={() => setPayMode(m)}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {payMode === 'part' && !isMembership && (
              <div className="fade-in" style={{ marginBottom: 16 }}>
                <div className="field">
                  <label>Paying now</label>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    placeholder="e.g. 5000"
                    value={partAmount}
                    onChange={(e) => setPartAmount(e.target.value)}
                  />
                </div>
                {/* "They might just pay 5,000 out of the 15,000 on the first day
                    and pay the rest tomorrow" — so say what is left, plainly. */}
                <div className="amount-box">
                  <span className="a-label">Remaining after this payment</span>
                  <span className="a-value">{fmt(Math.max(0, balance))}</span>
                </div>
                {partAmountInvalid && (
                  <div className="sub" style={{ color: '#b91c1c', marginTop: 6 }}>
                    Enter an amount between Rs. 1 and {fmt(total)}.
                  </div>
                )}
              </div>
            )}
            {payMode === 'later' && !isMembership && (
              <div className="alert amber" style={{ marginBottom: 16 }}>
                <Icon name="alert-triangle" size={17} />
                <div>
                  <div className="a-title">Nothing is being collected</div>
                  <div className="a-desc">
                    The whole {fmt(total)} stays owed on this sale until someone takes it.
                  </div>
                </div>
              </div>
            )}
            {payMode !== 'later' && (
              <>
                <label
                  style={{
                    display: 'block',
                    fontSize: 12,
                    fontWeight: 500,
                    color: '#64748b',
                    marginBottom: 8
                  }}
                >
                  Payment method
                </label>
                <div className="toggle-row">
                  <button
                    className={'toggle-btn' + (pay === 'Cash' ? ' sel' : '')}
                    onClick={() => setPay('Cash')}
                  >
                    <Icon name="banknote" size={17} /> Cash
                  </button>
                  <button
                    className={'toggle-btn' + (pay === 'QR' ? ' sel' : '')}
                    onClick={() => setPay('QR')}
                  >
                    <Icon name="qr-code" size={17} /> QR (eSewa / Khalti)
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="fade-in">
            {[
              ['Type', type],
              ['Customer', name || 'Walk-in'],
              ['Phone', phone || '—'],
              ['Payment', payMode === 'later' && !isMembership ? 'Nothing collected yet' : pay]
            ].map(([k, v]) => (
              <div
                key={k}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '9px 0',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 13
                }}
              >
                <span style={{ color: '#64748b' }}>{k}</span>
                <span style={{ color: '#1a202c' }}>{v}</span>
              </div>
            ))}
            {isMembership ? (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '9px 0',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 13
                }}
              >
                <span style={{ color: '#64748b' }}>Membership</span>
                <span style={{ color: '#1a202c' }}>
                  {membershipProduct?.displayName || membershipProduct?.name}
                </span>
              </div>
            ) : (
              (quote?.lines || []).map((l, i) => (
                <div
                  key={cart[i]?.uid ?? i}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '9px 0',
                    borderBottom: '1px solid var(--border)',
                    fontSize: 13
                  }}
                >
                  <span style={{ color: '#64748b' }}>
                    {l.description}
                    {l.tier === 'child' ? ' (child)' : ''} ×{l.quantity} @ {fmt(l.unitPrice)}
                  </span>
                  <span style={{ color: '#1a202c' }}>{fmt(l.lineTotal)}</span>
                </div>
              ))
            )}
            {FEATURES.memberPhoto && isMembership && photoPreview && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '9px 0',
                  borderBottom: '1px solid var(--border)',
                  fontSize: 13,
                  alignItems: 'center'
                }}
              >
                <span style={{ color: '#64748b' }}>Photo</span>
                <img
                  src={photoPreview}
                  alt="Preview"
                  style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover' }}
                />
              </div>
            )}
            {/* "1500 discount applied, and the reason for the discount right
                below" — both, on the screen where the money is agreed. */}
            {quote?.discountTotal > 0 && (
              <div style={{ padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ color: '#64748b' }}>Discount applied</span>
                  <span style={{ color: '#b45309' }}>− {fmt(quote.discountTotal)}</span>
                </div>
                {(quote.lines || [])
                  .filter((l) => l.lineDiscount > 0)
                  .map((l, i) => (
                    <div className="sub" key={i} style={{ marginTop: 3 }}>
                      {l.description}: {l.discountReason}
                    </div>
                  ))}
              </div>
            )}
            <div className="amount-box" style={{ marginTop: 14 }}>
              <span className="a-label">Total</span>
              <span className="a-value">{fmt(total)}</span>
            </div>
            {balance > 0 && (
              <div className="amount-box" style={{ marginTop: 8 }}>
                <span className="a-label">Paying now {fmt(paidNow)} · remaining</span>
                <span className="a-value">{fmt(balance)}</span>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="alert red" style={{ marginTop: 14 }}>
            <Icon name="alert-triangle" size={17} />
            <div className="a-desc">{error}</div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          {step > 0 && (
            <button className="btn btn-ghost" onClick={back}>
              <Icon name="chevron-left" size={16} /> Back
            </button>
          )}
          <div className="spacer" />
          {step < 4 ? (
            <button
              className="btn btn-primary"
              disabled={continueDisabled}
              style={continueDisabled ? { opacity: 0.5, cursor: 'not-allowed' } : null}
              onClick={next}
            >
              Continue <Icon name="chevron-right" size={16} />
            </button>
          ) : (
            <button
              className="btn btn-primary btn-block"
              style={{ width: 'auto', flex: 1 }}
              disabled={saving}
              onClick={handleSave}
            >
              <Icon name="check" size={16} /> {saving ? 'Saving…' : 'Confirm & Save'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
