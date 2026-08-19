import { useState, useEffect, useRef } from 'react'
import { api } from '../lib/api'
import { fmt, categoryToUiType, uiTypeToDbType, todayLocal } from '../lib/format'
import { Avatar, Badge, Icon } from '../components/ui'

const UI_TYPES = ['Membership', 'Day Package', 'Day Pass']

const STEP_LABELS = ['Type', 'Product', 'Customer', 'Payment', 'Confirm']

// StepBar and PhotoCapture live at module scope: defining them inside
// NewTransaction gave them a new identity on every keystroke, so React
// remounted them per character — the step bar blinked and the camera
// <video> element was torn down mid-preview.
function StepBar({ step }) {
  return (
    <div className="steps">
      {STEP_LABELS.map((l, i) => (
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
  for (const t of UI_TYPES) grouped[t] = []
  for (const p of products) {
    const ui = categoryToUiType(p.category)
    if (!grouped[ui]) grouped[ui] = []
    grouped[ui].push(p)
  }
  // Most-sold first (last 60 days), then by name, so staff see the products
  // they actually pick at the top of the list.
  for (const t of Object.keys(grouped)) {
    grouped[t].sort(
      (a, b) =>
        (counts[b.id] || 0) - (counts[a.id] || 0) ||
        (a.displayName || a.name).localeCompare(b.displayName || b.name)
    )
  }
  return grouped
}

export function NewTransaction({ session, onDone }) {
  const [step, setStep] = useState(0)
  const [type, setType] = useState('Day Pass')
  const [productId, setProductId] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [pay, setPay] = useState('Cash')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [products, setProducts] = useState([])
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
  // Tracks whether the staff member touched the product select themselves, so
  // the popularity preselect never overrides a choice they already made.
  const userPickedProductRef = useRef(false)

  useEffect(() => {
    Promise.all([api.listProducts(), api.productPopularity()])
      .then(([r, pop]) => {
        const list = r.products || []
        const counts = {}
        for (const c of pop.counts || []) counts[c.productId] = c.count
        setProducts(list)
        setPopularity(counts)
        setGrouped(groupProducts(list, counts))
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

  const selected = products.find((p) => String(p.id) === String(productId))
  const amount = selected?.price ?? 0
  const allPricesZero = products.length > 0 && products.every((p) => !p.price)
  // The all-zero banner never fires in the realistic case: the owner priced
  // most products and missed one. Warn on the SELECTED product instead, so a
  // Rs. 0 sale cannot be written without the staff member seeing it.
  const selectedUnpriced = !!selected && !(selected.price > 0)

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
      productId: selected?.id,
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
      product: selected?.displayName || selected?.name || productId,
      amount,
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
    setSaving(true)
    setError('')

    if (type === 'Membership') {
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

    const result = await api.createTransaction({
      type: uiTypeToDbType(type),
      source: 'pool',
      customerName: name || 'Walk-in',
      phone: phone || null,
      productId: selected?.id,
      amount,
      paymentMethod: pay.toLowerCase(),
      staffId: session?.userId
    })
    setSaving(false)
    if (result?.success === false) {
      setError(result.error || 'Failed to save transaction')
      return
    }
    setSavedTxn({
      transactionId: result.transactionId,
      product: selected?.displayName || selected?.name || productId,
      amount,
      pay,
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
    setType('Day Pass')
    setProductId('')
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

  // Most-picked (last 60 days) active product of a type with a real price —
  // the options are already sorted by sales count, so the first match is the
  // one staff sell most. Used to preselect; staff can still change it freely.
  const mostPopularId = (uiType) => {
    const best = (grouped[uiType] || []).find((p) => p.is_active !== 0 && Number(p.price) > 0)
    return best ? String(best.id) : ''
  }

  const next = () => {
    // Entering the product step with nothing selected: default to the most
    // popular product. Never overrides a choice the staff member already made.
    if (step === 0 && !productId && !userPickedProductRef.current) {
      setProductId(mostPopularId(type))
    }
    setStep((s) => Math.min(4, s + 1))
  }
  const back = () => setStep((s) => Math.max(0, s - 1))
  const typeProducts = grouped[type] || []

  return (
    <div
      className="content fade-in"
      style={{ display: 'grid', placeItems: 'start center', paddingTop: 26 }}
    >
      <div className="card" style={{ width: 500, padding: 22 }}>
        {loadError && (
          <div className="alert red" style={{ marginBottom: 14 }}>
            <Icon name="alert-triangle" size={17} />
            <div className="a-desc">{loadError}</div>
          </div>
        )}
        {!allPricesZero && selectedUnpriced && (
          <div className="alert amber" style={{ marginBottom: 14 }}>
            <Icon name="alert-triangle" size={17} />
            <div>
              <div className="a-title">
                {selected.displayName || selected.name} has no price set
              </div>
              <div className="a-desc">
                Saving now records a Rs. 0 sale. Ask the owner to set its price in Settings →
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
        <StepBar step={step} />
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
                  userPickedProductRef.current = false
                  // Type changed with no manual pick yet: preselect the most
                  // popular product of the new type (or clear if none).
                  setProductId(mostPopularId(t))
                }}
              >
                {UI_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <p className="sub" style={{ marginBottom: 4 }}>
              Pick what the customer is paying for to continue.
            </p>
          </div>
        )}
        {step === 1 && (
          <div className="fade-in">
            <div className="field">
              <label>Product</label>
              <select
                className="select"
                value={productId}
                onChange={(e) => {
                  userPickedProductRef.current = true
                  setProductId(e.target.value)
                }}
              >
                <option value="">Select a product…</option>
                {typeProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName || p.name} — {fmt(p.price)}
                  </option>
                ))}
              </select>
              {Object.keys(popularity).length > 0 && typeProducts.length > 0 && (
                <p className="sub" style={{ marginTop: 4 }}>
                  Most picked first
                </p>
              )}
              {/* An empty dropdown plus a greyed-out Continue is a dead end:
                  say why there is nothing to pick and where to go instead. */}
              {!loadingProducts && !loadError && typeProducts.length === 0 && (
                <p className="sub" style={{ marginTop: 6 }}>
                  No {type} products are set up. Press Back to choose another type, or ask the owner
                  to add one in Settings → Pricing manager.
                </p>
              )}
              {loadingProducts && (
                <p className="sub" style={{ marginTop: 6 }}>
                  Loading products…
                </p>
              )}
            </div>
            {productId && (
              <div className="amount-box">
                <span className="a-label">Amount</span>
                <span className="a-value">{fmt(amount)}</span>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="fade-in">
            <div className="field">
              <label>Transaction type</label>
              <select className="select" value={type} disabled style={{ color: '#475569' }}>
                <option>{type}</option>
              </select>
            </div>
            <div className="field">
              <label>Product</label>
              <select className="select" value={productId} disabled style={{ color: '#475569' }}>
                <option>{selected?.displayName || selected?.name}</option>
              </select>
            </div>
            <div className="field">
              {/* A membership is filed under this name, so it is required; a day
                  pass saves as "Walk-in". Say which before the Confirm step, not
                  after the customer has been asked to pay. */}
              <label>
                {type === 'Membership' ? 'Customer name (required)' : 'Customer name (optional)'}
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
            {type === 'Membership' && (
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
              <span className="a-value">{fmt(amount)}</span>
            </div>
          </div>
        )}
        {step === 3 && (
          <div className="fade-in">
            <div className="amount-box" style={{ marginBottom: 16 }}>
              <span className="a-label">Amount due</span>
              <span className="a-value">{fmt(amount)}</span>
            </div>
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
          </div>
        )}
        {step === 4 && (
          <div className="fade-in">
            {[
              ['Type', type],
              ['Product', selected?.displayName || selected?.name],
              ['Customer', name || 'Walk-in'],
              ['Phone', phone || '—'],
              ['Payment', pay]
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
            {type === 'Membership' && photoPreview && (
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
            <div className="amount-box" style={{ marginTop: 14 }}>
              <span className="a-label">Total</span>
              <span className="a-value">{fmt(amount)}</span>
            </div>
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
              disabled={step === 1 && !productId}
              style={step === 1 && !productId ? { opacity: 0.5, cursor: 'not-allowed' } : null}
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
