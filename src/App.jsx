import { useState, useEffect, useCallback } from 'react'
import { supabase } from './supabaseClient'
import './App.css'

// ─── Scale IDs — add more here if you expand ────────────────────────────────
const SCALE_IDS = ['scale_1', 'scale_2']

const DEFAULT_CONFIGS = {
  scale_1: {
    id: 'scale_1', item_name: 'Apples',  unit_weight_g: 150,
    shelf_location: 'Produce Shelf A', baseline_units: 0, baseline_checkout_count: 0,
  },
  scale_2: {
    id: 'scale_2', item_name: 'Oranges', unit_weight_g: 200,
    shelf_location: 'Produce Shelf B', baseline_units: 0, baseline_checkout_count: 0,
  },
}

// ─── Core metric calculation ─────────────────────────────────────────────────
//
//  Discrepancy logic:
//    Employee puts items on shelf → clicks "Set Shelf Baseline" → baseline recorded
//    removed_from_shelf  = baseline_units - current_units       (what scale detected leaving)
//    pos_since_baseline  = total_checkouts - baseline_checkout_count  (what was rung up)
//    unaccounted         = removed_from_shelf - pos_since_baseline
//    unaccounted > 0  →  theft / spoilage / misplacement → WARN MANAGER
//
//  Low-stock and discrepancy warnings are INDEPENDENT and show simultaneously.

function calcMetrics(weightG, unitWeightG, totalInvoiced, totalCheckedOut, baselineUnits, baselineCheckoutCount) {
  const onShelf = weightG !== null
    ? Math.max(0, Math.round(weightG / (unitWeightG || 1)))
    : null

  const inStorage = onShelf !== null
    ? Math.max(0, totalInvoiced - onShelf - totalCheckedOut)
    : null

  const lowStock   = onShelf !== null && onShelf > 0 && onShelf <= 3
  const outOfStock = onShelf !== null && onShelf === 0

  // Discrepancy: items removed from shelf not accounted for by POS
  const hasBaseline = (baselineUnits || 0) > 0
  let unaccounted = 0
  if (hasBaseline && onShelf !== null) {
    const removedFromShelf   = Math.max(0, baselineUnits - onShelf)
    const checkoutsSinceBase = Math.max(0, totalCheckedOut - (baselineCheckoutCount || 0))
    unaccounted = Math.max(0, removedFromShelf - checkoutsSinceBase)
  }

  return { onShelf, inStorage, lowStock, outOfStock, unaccounted, hasBaseline }
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function App() {
  const [scales,    setScales]    = useState(DEFAULT_CONFIGS)
  const [readings,  setReadings]  = useState({ scale_1: null, scale_2: null })
  const [invoices,  setInvoices]  = useState({ scale_1: 0,    scale_2: 0    })
  const [checkouts, setCheckouts] = useState({ scale_1: 0,    scale_2: 0    })
  const [loading,   setLoading]   = useState(true)
  const [editCfg,   setEditCfg]   = useState(DEFAULT_CONFIGS)
  const [invInput,  setInvInput]  = useState({ scale_1: '', scale_2: '' })
  const [chkInput,  setChkInput]  = useState({ scale_1: '', scale_2: '' })
  const [wtInput,   setWtInput]   = useState({ scale_1: '', scale_2: '' })
  const [flash,     setFlash]     = useState({})

  // ── initial load ───────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    const { data: cfgData } = await supabase.from('scales').select('*')
    if (cfgData && cfgData.length > 0) {
      const map = { ...DEFAULT_CONFIGS }
      cfgData.forEach(s => { map[s.id] = { ...DEFAULT_CONFIGS[s.id], ...s } })
      setScales(map)
      setEditCfg(JSON.parse(JSON.stringify(map)))
    }

    const newReadings = { scale_1: null, scale_2: null }
    for (const id of SCALE_IDS) {
      const { data } = await supabase
        .from('readings').select('weight_g')
        .eq('scale_id', id).order('created_at', { ascending: false }).limit(1)
      if (data && data.length > 0) newReadings[id] = parseFloat(data[0].weight_g)
    }
    setReadings(newReadings)

    const newInv = { scale_1: 0, scale_2: 0 }
    for (const id of SCALE_IDS) {
      const { data } = await supabase.from('invoices').select('quantity').eq('scale_id', id)
      if (data) newInv[id] = data.reduce((s, r) => s + r.quantity, 0)
    }
    setInvoices(newInv)

    const newChk = { scale_1: 0, scale_2: 0 }
    for (const id of SCALE_IDS) {
      const { data } = await supabase.from('checkouts').select('quantity').eq('scale_id', id)
      if (data) newChk[id] = data.reduce((s, r) => s + r.quantity, 0)
    }
    setCheckouts(newChk)

    setLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  // ── realtime subscriptions ─────────────────────────────────────────────────

  useEffect(() => {
    const channels = SCALE_IDS.map(id =>
      supabase.channel(`rt-${id}`)
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'readings', filter: `scale_id=eq.${id}` },
          ({ new: row }) => setReadings(p => ({ ...p, [id]: parseFloat(row.weight_g) })))
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'invoices', filter: `scale_id=eq.${id}` },
          ({ new: row }) => setInvoices(p => ({ ...p, [id]: p[id] + row.quantity })))
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'checkouts', filter: `scale_id=eq.${id}` },
          ({ new: row }) => setCheckouts(p => ({ ...p, [id]: p[id] + row.quantity })))
        .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'scales', filter: `id=eq.${id}` },
          ({ new: row }) => {
            setScales(p => ({ ...p, [id]: { ...p[id], ...row } }))
            setEditCfg(p => ({ ...p, [id]: { ...p[id], ...row } }))
          })
        .subscribe()
    )
    return () => channels.forEach(c => supabase.removeChannel(c))
  }, [])

  // ── flash helper ───────────────────────────────────────────────────────────

  const showFlash = (key, msg, type = 'success') => {
    setFlash(p => ({ ...p, [key]: { msg, type } }))
    setTimeout(() => setFlash(p => { const n = { ...p }; delete n[key]; return n }), 4000)
  }

  // ── actions ────────────────────────────────────────────────────────────────

  // Employee stocks shelf → sets discrepancy baseline from current reading
  const setBaseline = async (id) => {
    const cfg = scales[id]
    const wt  = readings[id]
    if (wt === null) return showFlash(id + '_base', 'Submit a weight reading first, then set baseline', 'warn')

    const units            = Math.max(0, Math.round(wt / (cfg.unit_weight_g || 1)))
    const currentCheckouts = checkouts[id] || 0

    const { error } = await supabase
      .from('scales')
      .update({ baseline_units: units, baseline_checkout_count: currentCheckouts })
      .eq('id', id)

    if (!error) {
      setScales(p => ({ ...p, [id]: { ...p[id], baseline_units: units, baseline_checkout_count: currentCheckouts } }))
      showFlash(id + '_base', `Baseline set: ${units} units on shelf. Discrepancy tracking is now active.`)
    } else {
      showFlash(id + '_base', 'Error: ' + error.message, 'error')
    }
  }

  const addInvoice = async (id) => {
    const qty = parseInt(invInput[id])
    if (!qty || qty <= 0) return showFlash(id + '_inv', 'Enter a valid quantity', 'warn')
    const { error } = await supabase.from('invoices').insert({ scale_id: id, quantity: qty })
    if (!error) {
      setInvInput(p => ({ ...p, [id]: '' }))
      showFlash(id + '_inv', `Invoiced +${qty} units`)
    } else {
      showFlash(id + '_inv', 'Error: ' + error.message, 'error')
    }
  }

  const doCheckout = async (id) => {
    const qty     = parseInt(chkInput[id])
    const cfg     = scales[id]
    const wt      = readings[id]
    const onShelf = wt !== null ? Math.max(0, Math.round(wt / (cfg.unit_weight_g || 1))) : null

    if (!qty || qty <= 0) return showFlash(id + '_pos', 'Enter a valid quantity', 'warn')

    const { error } = await supabase.from('checkouts').insert({ scale_id: id, quantity: qty })
    if (error) return showFlash(id + '_pos', 'Error: ' + error.message, 'error')

    setChkInput(p => ({ ...p, [id]: '' }))

    // Inform but don't block — scale might be slightly miscalibrated
    if (onShelf !== null && qty > onShelf) {
      showFlash(id + '_pos',
        `POS: ${qty} checked out. Note: scale only shows ${onShelf} on shelf — verify scale calibration.`,
        'warn'
      )
    } else {
      showFlash(id + '_pos', `POS: ${qty} item(s) checked out.`)
    }
  }

  const submitWeight = async (id) => {
    const w = parseFloat(wtInput[id])
    if (isNaN(w) || w < 0) return showFlash(id + '_wt', 'Enter weight in grams', 'warn')
    const { error } = await supabase.from('readings').insert({ scale_id: id, weight_g: w })
    if (!error) {
      setWtInput(p => ({ ...p, [id]: '' }))
      showFlash(id + '_wt', `Weight ${w}g recorded`)
    } else {
      showFlash(id + '_wt', 'Error: ' + error.message, 'error')
    }
  }

  const saveConfig = async (id) => {
    const cfg     = editCfg[id]
    const current = scales[id]
    const payload = {
      id,
      item_name:               cfg.item_name?.trim() || 'Unknown',
      unit_weight_g:           parseFloat(cfg.unit_weight_g) || 100,
      shelf_location:          cfg.shelf_location?.trim() || '',
      baseline_units:          current.baseline_units || 0,
      baseline_checkout_count: current.baseline_checkout_count || 0,
    }
    const { error } = await supabase.from('scales').upsert(payload)
    if (!error) {
      setScales(p => ({ ...p, [id]: { ...p[id], ...payload } }))
      showFlash(id + '_cfg', 'Config saved')
    } else {
      showFlash(id + '_cfg', 'Error: ' + error.message, 'error')
    }
  }

  const resetScale = async (id) => {
    if (!window.confirm(`Reset ALL data for ${scales[id]?.item_name}? This cannot be undone.`)) return
    await supabase.from('readings').delete().eq('scale_id', id)
    await supabase.from('invoices').delete().eq('scale_id', id)
    await supabase.from('checkouts').delete().eq('scale_id', id)
    await supabase.from('scales').update({ baseline_units: 0, baseline_checkout_count: 0 }).eq('id', id)
    setReadings(p  => ({ ...p,  [id]: null }))
    setInvoices(p  => ({ ...p,  [id]: 0    }))
    setCheckouts(p => ({ ...p,  [id]: 0    }))
    setScales(p    => ({ ...p,  [id]: { ...p[id], baseline_units: 0, baseline_checkout_count: 0 } }))
    showFlash(id, 'All data cleared', 'warn')
  }

  // ── render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="splash">
        <div className="spinner" />
        <p>Connecting to ShelfSense...</p>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <span className="logo-text">ShelfSense</span>
          <div>
            <h1>Live Inventory Dashboard</h1>
            <p className="subtitle">Real-time grocery shelf monitoring · LoRa scale network</p>
          </div>
          <span className="badge-live">LIVE</span>
        </div>
      </header>

      <main className="main">
        {SCALE_IDS.map(id => {
          const cfg      = scales[id] || DEFAULT_CONFIGS[id]
          const edit     = editCfg[id] || cfg
          const totalInv = invoices[id]  || 0
          const totalChk = checkouts[id] || 0
          const wt       = readings[id]

          const { onShelf, inStorage, lowStock, outOfStock, unaccounted, hasBaseline } =
            calcMetrics(
              wt,
              cfg.unit_weight_g || 1,
              totalInv,
              totalChk,
              cfg.baseline_units || 0,
              cfg.baseline_checkout_count || 0
            )

          const hasAnyAlert = outOfStock || lowStock || unaccounted > 0

          return (
            <div key={id} className={`card ${hasAnyAlert ? 'card-alert' : ''}`}>

              {/* ─ card header ─ */}
              <div className="card-top">
                <div>
                  <h2 className="item-name">{cfg.item_name}</h2>
                  <span className="shelf-tag">{cfg.shelf_location}</span>
                </div>
                <span className="scale-badge">{id}</span>
              </div>

              {/* ─ 5 stat boxes ─ */}
              <div className="stats">

                <div className="stat">
                  <div className="sv">{totalInv}</div>
                  <div className="sl">Total Invoiced</div>
                </div>

                <div className={`stat ${outOfStock ? 'stat-empty' : lowStock ? 'stat-low' : 'stat-shelf'}`}>
                  <div className="sv">{onShelf ?? '—'}</div>
                  <div className="sl">On Shelf</div>
                  {wt !== null && <div className="ss">{wt.toFixed(0)} g</div>}
                </div>

                <div className="stat">
                  <div className="sv">{inStorage ?? '—'}</div>
                  <div className="sl">In Storage</div>
                  <div className="ss">invoice − shelf − sold</div>
                </div>

                <div className="stat">
                  <div className="sv">{totalChk}</div>
                  <div className="sl">Checked Out</div>
                </div>

                <div className={`stat ${!hasBaseline ? 'stat-neutral' : unaccounted > 0 ? 'stat-disc-warn' : 'stat-disc-ok'}`}>
                  <div className="sv">{hasBaseline ? unaccounted : '—'}</div>
                  <div className="sl">Unaccounted</div>
                  <div className="ss">
                    {!hasBaseline ? 'No baseline' : unaccounted > 0 ? 'Investigate' : 'OK'}
                  </div>
                </div>

              </div>

              {/* ─ alert banners — all independent, stack if multiple triggered ─ */}

              {!hasBaseline && wt !== null && (
                <div className="banner banner-info">
                  Discrepancy tracking is inactive. Click "Set Shelf Baseline" after stocking the shelf to start monitoring for theft and spoilage.
                </div>
              )}

              {outOfStock && (
                <div className="banner banner-red">
                  Shelf is empty — send staff to restock from storage immediately.
                </div>
              )}

              {lowStock && !outOfStock && (
                <div className="banner banner-amber">
                  Low stock: only {onShelf} item(s) left on shelf (threshold: 3). Restock soon.
                </div>
              )}

              {unaccounted > 0 && (
                <div className="banner banner-red">
                  {unaccounted} item(s) removed from shelf with no POS record since last baseline.
                  Possible cause: theft, spoilage/disposal, or misplacement to another shelf.
                </div>
              )}

              {/* ─ actions ─ */}
              <div className="actions">

                {/* Baseline — employee clicks this when stocking shelf */}
                <div className="action-group">
                  <div className="ag-label">
                    Shelf Baseline
                    <span className="hint"> — set after employee stocks shelf from storage</span>
                  </div>
                  <div className="ag-row">
                    <div className="baseline-status">
                      {hasBaseline
                        ? `Active: ${cfg.baseline_units} units placed on shelf (POS at baseline: ${cfg.baseline_checkout_count})`
                        : 'Not set — submit a weight first, then click Set'}
                    </div>
                    <button className="btn btn-teal" onClick={() => setBaseline(id)}>
                      Set Shelf Baseline
                    </button>
                  </div>
                  <Flash k={id + '_base'} flash={flash} />
                </div>

                {/* Invoice */}
                <div className="action-group">
                  <div className="ag-label">Set Invoice</div>
                  <div className="ag-row">
                    <input
                      type="number" min="1" placeholder="Qty received from warehouse"
                      value={invInput[id]}
                      onChange={e => setInvInput(p => ({ ...p, [id]: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && addInvoice(id)}
                    />
                    <button className="btn btn-blue" onClick={() => addInvoice(id)}>+ Add Invoice</button>
                  </div>
                  <Flash k={id + '_inv'} flash={flash} />
                </div>

                {/* POS */}
                <div className="action-group">
                  <div className="ag-label">POS Checkout</div>
                  <div className="ag-row">
                    <input
                      type="number" min="1" placeholder="Qty sold at register"
                      value={chkInput[id]}
                      onChange={e => setChkInput(p => ({ ...p, [id]: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && doCheckout(id)}
                    />
                    <button className="btn btn-dark" onClick={() => doCheckout(id)}>Checkout</button>
                  </div>
                  <Flash k={id + '_pos'} flash={flash} />
                </div>

                {/* Manual weight — placeholder for LoRa */}
                <div className="action-group">
                  <div className="ag-label">
                    Manual Weight Input
                    <span className="hint"> — LoRa auto-fills this in production</span>
                  </div>
                  <div className="ag-row">
                    <input
                      type="number" min="0" step="0.1" placeholder="Weight in grams"
                      value={wtInput[id]}
                      onChange={e => setWtInput(p => ({ ...p, [id]: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && submitWeight(id)}
                    />
                    <button className="btn btn-ghost" onClick={() => submitWeight(id)}>Submit</button>
                  </div>
                  <Flash k={id + '_wt'} flash={flash} />
                </div>

              </div>

              {/* ─ configure ─ */}
              <details className="details-block">
                <summary>Configure Scale</summary>
                <div className="config-grid">
                  <label>
                    <span>Item Name</span>
                    <input value={edit.item_name || ''}
                      onChange={e => setEditCfg(p => ({ ...p, [id]: { ...p[id], item_name: e.target.value } }))} />
                  </label>
                  <label>
                    <span>Unit Weight (g)</span>
                    <input type="number" value={edit.unit_weight_g || ''}
                      onChange={e => setEditCfg(p => ({ ...p, [id]: { ...p[id], unit_weight_g: e.target.value } }))} />
                  </label>
                  <label>
                    <span>Shelf Location</span>
                    <input value={edit.shelf_location || ''}
                      onChange={e => setEditCfg(p => ({ ...p, [id]: { ...p[id], shelf_location: e.target.value } }))} />
                  </label>
                </div>
                <div className="config-btns">
                  <button className="btn btn-blue" onClick={() => saveConfig(id)}>Save Config</button>
                  <button className="btn btn-danger" onClick={() => resetScale(id)}>Reset All Data</button>
                </div>
                <Flash k={id + '_cfg'} flash={flash} />
              </details>

              {/* ─ LoRa API reference ─ */}
              <details className="details-block">
                <summary>LoRa / Pi Integration — POST endpoint</summary>
                <p className="api-note">
                  From your Raspberry Pi, POST directly to Supabase REST.
                  The dashboard updates live across all browsers instantly.
                </p>
                <pre className="code-pre">{`curl -X POST \\
  '${import.meta.env.VITE_SUPABASE_URL}/rest/v1/readings' \\
  -H 'apikey: ${import.meta.env.VITE_SUPABASE_ANON_KEY?.slice(0, 40)}...' \\
  -H 'Content-Type: application/json' \\
  -d '{"scale_id":"${id}","weight_g":1500.0}'`}
                </pre>
              </details>

            </div>
          )
        })}
      </main>

      <footer className="footer">
        <p>ShelfSense · Georgia Tech CREATE-X Capstone · Team 17</p>
        <p className="footer-sub">Real-time via Supabase Realtime WebSockets · 2 LoRa scales</p>
      </footer>
    </div>
  )
}

// ─── Flash message component ─────────────────────────────────────────────────

function Flash({ k, flash }) {
  const f = flash[k]
  if (!f) return null
  return <div className={`flash flash-${f.type}`}>{f.msg}</div>
}