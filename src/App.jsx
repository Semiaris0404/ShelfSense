import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from './supabaseClient'
import StoreMap from './StoreMap'
import './App.css'
import './StoreMap.css'
import ScaleControlModal from './ScaleControlModal'

// DB uses scale_1/scale_2 internally — we display as sensor_1/sensor_2
const ALL_SENSOR_IDS    = ['scale_1', 'scale_2', 'scale_3', 'scale_4', 'scale_5', 'scale_6']
const ACTIVE_SENSOR_IDS = new Set(['scale_1', 'scale_2'])
const toSensorId = (id) => id ? id.replace('scale_', 'sensor_') : id

// ─── Core metric calculation ─────────────────────────────────────────────────

function rawToUnits(raw, tareOffset, kCalibration) {
  if (raw === null || raw === undefined) return null
  if (!kCalibration || kCalibration <= 0) return null
  return Math.max(0, Math.round((raw - (tareOffset || 0)) / kCalibration))
}

function calcMetrics(rawValue, tareOffset, kCalibration, totalInvoiced, totalCheckedOut, baselineUnits, baselineCheckoutCount) {
  const onShelf = rawToUnits(rawValue, tareOffset, kCalibration)
  const hasBaseline = (baselineUnits || 0) > 0
  let unaccounted = 0
  if (hasBaseline && onShelf !== null) {
    const removedFromShelf   = Math.max(0, baselineUnits - onShelf)
    const checkoutsSinceBase = Math.max(0, totalCheckedOut - (baselineCheckoutCount || 0))
    unaccounted = Math.max(0, removedFromShelf - checkoutsSinceBase)
  }
  const totalInventory = Math.max(0, totalInvoiced - totalCheckedOut)
  const inStorage = onShelf !== null
    ? Math.max(0, totalInvoiced - onShelf - totalCheckedOut - unaccounted)
    : totalInventory
  const lowStock   = onShelf !== null && onShelf > 0 && onShelf <= 3
  const outOfStock = onShelf !== null && onShelf === 0
  const overStock  = hasBaseline && onShelf !== null && onShelf > (baselineUnits || 0)
  return { onShelf, inStorage, lowStock, outOfStock, overStock, unaccounted, hasBaseline, totalInventory }
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function App() {
  const [activeTab, setActiveTab] = useState('map')
  const [scales,    setScales]    = useState({})
  const [readings,  setReadings]  = useState({})
  const [invoices,  setInvoices]  = useState({})
  const [checkouts, setCheckouts] = useState({})
  const [loading,   setLoading]   = useState(true)
  const [editCfg,   setEditCfg]   = useState({})
  const [invInput,  setInvInput]  = useState({})
  const [chkInput,  setChkInput]  = useState({})
  const [wtInput,   setWtInput]   = useState({})
  const [adjAddQty,   setAdjAddQty]   = useState({})
  const [adjAddNote,  setAdjAddNote]  = useState({})
  const [adjRemQty,   setAdjRemQty]   = useState({})
  const [adjRemNote,  setAdjRemNote]  = useState({})
  const [flash,       setFlash]       = useState({})
  const [openModalId, setOpenModalId] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addForm,      setAddForm]      = useState({ id: '', item_name: '', unit_weight_g: 150, shelf_location: '' })
  const [addError,     setAddError]     = useState('')
  const [addLoading,   setAddLoading]   = useState(false)
  const [selectedMapNode, setSelectedMapNode] = useState(null)
  const channelsRef = useRef({})

  const subscribeToScale = useCallback((id) => {
    if (channelsRef.current[id]) return
    const ch = supabase.channel(`rt-${id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'invoices', filter: `scale_id=eq.${id}` },
        ({ new: row }) => setInvoices(p => ({ ...p, [id]: (p[id] || 0) + row.quantity })))
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'checkouts', filter: `scale_id=eq.${id}` },
        ({ new: row }) => setCheckouts(p => ({ ...p, [id]: (p[id] || 0) + row.quantity })))
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'scales', filter: `id=eq.${id}` },
        ({ new: row }) => {
          setReadings(p => ({ ...p, [id]: row.raw_value === null || row.raw_value === undefined ? null : parseFloat(row.raw_value) }))
          setScales(p => ({ ...p, [id]: { ...p[id], ...row } }))
          setEditCfg(p => ({ ...p, [id]: { ...p[id], ...row } }))
        })
      .subscribe()
    channelsRef.current[id] = ch
  }, [])

  useEffect(() => {
    return () => { Object.values(channelsRef.current).forEach(c => supabase.removeChannel(c)) }
  }, [])

  const refreshLiveData = useCallback(async () => {
    const { data: cfgData } = await supabase.from('scales').select('*')
    const ids = (cfgData || []).map(s => s.id)
    setScales(prev => {
      const next = { ...prev }
      ;(cfgData || []).forEach(row => {
        next[row.id] = { id: row.id, item_name: 'Unknown Item', unit_weight_g: 100, shelf_location: '',
          baseline_units: 0, baseline_checkout_count: 0, tare_offset: 0, K_calibration: null, raw_value: null,
          ...(next[row.id] || {}), ...row }
      })
      return next
    })
    setEditCfg(prev => {
      const next = { ...prev }
      ;(cfgData || []).forEach(row => {
        next[row.id] = { id: row.id, item_name: 'Unknown Item', unit_weight_g: 100, shelf_location: '',
          baseline_units: 0, baseline_checkout_count: 0, tare_offset: 0, K_calibration: null, raw_value: null,
          ...(next[row.id] || {}), ...row }
      })
      return next
    })
    const newReadings = {}, newInv = {}, newChk = {}
    for (const id of ids) {
      const rawValue = cfgData?.find(row => row.id === id)?.raw_value
      newReadings[id] = rawValue === null || rawValue === undefined ? null : parseFloat(rawValue)
      const { data: inv } = await supabase.from('invoices').select('quantity').eq('scale_id', id)
      newInv[id] = inv ? inv.reduce((s, r) => s + r.quantity, 0) : 0
      const { data: chk } = await supabase.from('checkouts').select('quantity').eq('scale_id', id)
      newChk[id] = chk ? chk.reduce((s, r) => s + r.quantity, 0) : 0
    }
    setReadings(newReadings); setInvoices(newInv); setCheckouts(newChk)
    ids.forEach(id => subscribeToScale(id))
  }, [subscribeToScale])

  const loadAll = useCallback(async () => {
    const { data: cfgData } = await supabase.from('scales').select('*')
    const ids = (cfgData || []).map(s => s.id)
    const cfgMap = {}
    ;(cfgData || []).forEach(row => {
      cfgMap[row.id] = { id: row.id, item_name: 'Unknown Item', unit_weight_g: 100, shelf_location: '',
        baseline_units: 0, baseline_checkout_count: 0, tare_offset: 0, K_calibration: null, raw_value: null, ...row }
    })
    setScales(cfgMap)
    setEditCfg(JSON.parse(JSON.stringify(cfgMap)))
    const newReadings = {}, newInv = {}, newChk = {}
    for (const id of ids) {
      const rawValue = cfgMap[id]?.raw_value
      newReadings[id] = rawValue === null || rawValue === undefined ? null : parseFloat(rawValue)
      const { data: inv } = await supabase.from('invoices').select('quantity').eq('scale_id', id)
      newInv[id] = inv ? inv.reduce((s, r) => s + r.quantity, 0) : 0
      const { data: chk } = await supabase.from('checkouts').select('quantity').eq('scale_id', id)
      newChk[id] = chk ? chk.reduce((s, r) => s + r.quantity, 0) : 0
    }
    setReadings(newReadings); setInvoices(newInv); setCheckouts(newChk)
    const emptyStr = ids.reduce((acc, id) => ({ ...acc, [id]: '' }), {})
    setInvInput(emptyStr); setChkInput({ ...emptyStr }); setWtInput({ ...emptyStr })
    setAdjAddQty({ ...emptyStr }); setAdjAddNote({ ...emptyStr })
    setAdjRemQty({ ...emptyStr }); setAdjRemNote({ ...emptyStr })
    ids.forEach(id => subscribeToScale(id))
    setLoading(false)
  }, [subscribeToScale])

  useEffect(() => { loadAll() }, [loadAll])
  useEffect(() => {
    const intervalId = window.setInterval(() => { refreshLiveData() }, 5000)
    return () => window.clearInterval(intervalId)
  }, [refreshLiveData])

  const showFlash = (key, msg, type = 'success') => {
    setFlash(p => ({ ...p, [key]: { msg, type } }))
    setTimeout(() => setFlash(p => { const n = { ...p }; delete n[key]; return n }), 4000)
  }

  const setBaseline = async (id) => {
    const cfg = scales[id], raw = readings[id]
    const units = rawToUnits(raw, cfg.tare_offset, cfg.K_calibration)
    if (units === null) return showFlash(id + '_base', 'Need a raw reading and a calibrated sensor first', 'warn')
    const currentCheckouts = checkouts[id] || 0
    const { error } = await supabase.from('scales').update({ baseline_units: units, baseline_checkout_count: currentCheckouts }).eq('id', id)
    if (!error) {
      setScales(p => ({ ...p, [id]: { ...p[id], baseline_units: units, baseline_checkout_count: currentCheckouts } }))
      showFlash(id + '_base', `Baseline set: ${units} units. Tracking active.`)
    } else showFlash(id + '_base', 'Error: ' + error.message, 'error')
  }

  const addInvoice = async (id) => {
    const qty = parseInt(invInput[id])
    if (!qty || qty <= 0) return showFlash(id + '_inv', 'Enter a valid quantity', 'warn')
    const { error } = await supabase.from('invoices').insert({ scale_id: id, quantity: qty })
    if (!error) { setInvoices(p => ({ ...p, [id]: (p[id] || 0) + qty })); setInvInput(p => ({ ...p, [id]: '' })); showFlash(id + '_inv', `Invoiced +${qty} units`) }
    else showFlash(id + '_inv', 'Error: ' + error.message, 'error')
  }

  const doCheckout = async (id) => {
    const qty = parseInt(chkInput[id])
    const cfg = scales[id], raw = readings[id]
    const onShelf = rawToUnits(raw, cfg.tare_offset, cfg.K_calibration)
    if (!qty || qty <= 0) return showFlash(id + '_pos', 'Enter a valid quantity', 'warn')
    const { error } = await supabase.from('checkouts').insert({ scale_id: id, quantity: qty })
    if (error) return showFlash(id + '_pos', 'Error: ' + error.message, 'error')
    setCheckouts(p => ({ ...p, [id]: (p[id] || 0) + qty })); setChkInput(p => ({ ...p, [id]: '' }))
    if (onShelf !== null && qty > onShelf) showFlash(id + '_pos', `POS: ${qty} checked out. Note: sensor shows only ${onShelf} on shelf.`, 'warn')
    else showFlash(id + '_pos', `POS: ${qty} item(s) checked out.`)
  }

  const submitWeight = async (id) => {
    const v = parseFloat(wtInput[id])
    if (isNaN(v)) return showFlash(id + '_wt', 'Enter a raw load-cell value', 'warn')
    const { error: insertError } = await supabase.from('readings').insert({ scale_id: id, raw_value: v })
    if (insertError) return showFlash(id + '_wt', 'Error: ' + insertError.message, 'error')
    const { error: updateError } = await supabase.from('scales').update({ raw_value: v }).eq('id', id)
    if (!updateError) { setReadings(p => ({ ...p, [id]: v })); setScales(p => ({ ...p, [id]: { ...p[id], raw_value: v } })); setWtInput(p => ({ ...p, [id]: '' })); showFlash(id + '_wt', `Raw value ${v} recorded`) }
    else showFlash(id + '_wt', 'Error: ' + updateError.message, 'error')
  }

  const manualAdd = async (id) => {
    const qty = parseInt(adjAddQty[id])
    if (!qty || qty <= 0) return showFlash(id + '_adj_add', 'Enter a valid quantity', 'warn')
    const note = adjAddNote[id]?.trim() || 'Manual addition'
    const { error } = await supabase.from('invoices').insert({ scale_id: id, quantity: qty, note })
    if (!error) { setInvoices(p => ({ ...p, [id]: (p[id] || 0) + qty })); setAdjAddQty(p => ({ ...p, [id]: '' })); setAdjAddNote(p => ({ ...p, [id]: '' })); showFlash(id + '_adj_add', `+${qty} unit(s) added`) }
    else showFlash(id + '_adj_add', 'Error: ' + error.message, 'error')
  }

  const manualDiscard = async (id) => {
    const qty = parseInt(adjRemQty[id])
    if (!qty || qty <= 0) return showFlash(id + '_adj_rem', 'Enter a valid quantity', 'warn')
    const { error } = await supabase.from('checkouts').insert({ scale_id: id, quantity: qty })
    if (!error) { setCheckouts(p => ({ ...p, [id]: (p[id] || 0) + qty })); setAdjRemQty(p => ({ ...p, [id]: '' })); setAdjRemNote(p => ({ ...p, [id]: '' })); showFlash(id + '_adj_rem', `${qty} unit(s) discarded`) }
    else showFlash(id + '_adj_rem', 'Error: ' + error.message, 'error')
  }

  const saveConfig = async (id) => {
    const cfg = editCfg[id], current = scales[id]
    const payload = { id, item_name: cfg.item_name?.trim() || 'Unknown', unit_weight_g: parseFloat(cfg.unit_weight_g) || 100,
      shelf_location: cfg.shelf_location?.trim() || '', baseline_units: current.baseline_units || 0,
      baseline_checkout_count: current.baseline_checkout_count || 0, raw_value: current.raw_value ?? null,
      tare_offset: current.tare_offset ?? 0, K_calibration: current.K_calibration ?? null }
    const { error } = await supabase.from('scales').upsert(payload)
    if (!error) { setScales(p => ({ ...p, [id]: { ...p[id], ...payload } })); showFlash(id + '_cfg', 'Config saved') }
    else showFlash(id + '_cfg', 'Error: ' + error.message, 'error')
  }

  const resetScale = async (id) => {
    if (!window.confirm(`Reset ALL data for ${scales[id]?.item_name}? This cannot be undone.`)) return
    await supabase.from('invoices').delete().eq('scale_id', id)
    await supabase.from('checkouts').delete().eq('scale_id', id)
    await supabase.from('scales').update({ baseline_units: 0, baseline_checkout_count: 0, raw_value: null }).eq('id', id)
    setReadings(p => ({ ...p, [id]: null })); setInvoices(p => ({ ...p, [id]: 0 })); setCheckouts(p => ({ ...p, [id]: 0 }))
    setScales(p => ({ ...p, [id]: { ...p[id], baseline_units: 0, baseline_checkout_count: 0, raw_value: null } }))
    showFlash(id, 'All data cleared', 'warn')
  }

  const addItem = async () => {
    const id = addForm.id.trim()
    if (!id) { setAddError('Sensor ID is required'); return }
    if (scales[id]) { setAddError('A sensor with that ID already exists'); return }
    setAddLoading(true); setAddError('')
    const newConfig = { id, item_name: addForm.item_name.trim() || 'Unknown Item', unit_weight_g: parseFloat(addForm.unit_weight_g) || 100,
      shelf_location: addForm.shelf_location.trim(), baseline_units: 0, baseline_checkout_count: 0, tare_offset: 0, K_calibration: null, raw_value: null }
    const { error } = await supabase.from('scales').insert(newConfig)
    setAddLoading(false)
    if (error) { setAddError('Error: ' + error.message); return }
    setScales(p => ({ ...p, [id]: newConfig })); setEditCfg(p => ({ ...p, [id]: { ...newConfig } }))
    setReadings(p => ({ ...p, [id]: null })); setInvoices(p => ({ ...p, [id]: 0 })); setCheckouts(p => ({ ...p, [id]: 0 }))
    setInvInput(p => ({ ...p, [id]: '' })); setChkInput(p => ({ ...p, [id]: '' })); setWtInput(p => ({ ...p, [id]: '' }))
    setAdjAddQty(p => ({ ...p, [id]: '' })); setAdjAddNote(p => ({ ...p, [id]: '' }))
    setAdjRemQty(p => ({ ...p, [id]: '' })); setAdjRemNote(p => ({ ...p, [id]: '' }))
    subscribeToScale(id); setShowAddModal(false)
    setAddForm({ id: '', item_name: '', unit_weight_g: 150, shelf_location: '' }); setAddError('')
  }

  const cardBag = (id) => ({
    id, scales, editCfg, setEditCfg, readings, invoices, checkouts,
    invInput, setInvInput, chkInput, setChkInput, wtInput, setWtInput,
    adjAddQty, setAdjAddQty, adjAddNote, setAdjAddNote,
    adjRemQty, setAdjRemQty, adjRemNote, setAdjRemNote,
    flash, openModalId, setOpenModalId,
    setBaseline, addInvoice, doCheckout, submitWeight,
    manualAdd, manualDiscard, saveConfig, resetScale,
  })

  if (loading) return (
    <div className="splash"><div className="spinner" /><p>Connecting to inSpecter...</p></div>
  )

  const scaleIds = Object.keys(scales)
  const panelId  = selectedMapNode?.id ?? null

  return (
    <div className="app">

      {/* ─ header ─ */}
      <header className="header">
        <div className="header-inner">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
            <img
              src="/inSpecter_backless.png"
              alt="inSpecter"
              style={{ height: 52, width: 'auto', objectFit: 'contain', flexShrink: 0 }}
            />
            <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500, paddingLeft: 2 }}>
              Live Inventory Dashboard
            </span>
          </div>
          <span className="badge-live">● LIVE</span>
        </div>
      </header>

      {/* ─ tab bar ─ */}
      <div className="tab-bar">
        <button className={`tab-btn ${activeTab === 'map' ? 'active' : ''}`} onClick={() => setActiveTab('map')}>Store Map</button>
        <button className={`tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>Dashboard</button>
      </div>

      {/* ─ store map tab ─ */}
      {activeTab === 'map' && (
        <div className={`map-layout${panelId ? ' map-layout-split' : ''}`}>
          <StoreMap scales={scales} readings={readings} invoices={invoices} checkouts={checkouts}
            selectedNodeId={selectedMapNode?.id ?? null} onNodeSelect={setSelectedMapNode} />

          {panelId && scales[panelId] && (
            <div className="map-detail-panel">
              <div className="map-detail-header">
                <div>
                  <div className="map-detail-title">{scales[panelId].item_name}</div>
                  <div className="map-detail-sub">{selectedMapNode.label} · <span className="scale-badge">{toSensorId(panelId)}</span></div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 11px' }} onClick={() => setOpenModalId(panelId)}>
                    ⚙ Sensor Controls
                  </button>
                  <button className="modal-close" onClick={() => setSelectedMapNode(null)} aria-label="Close panel">✕</button>
                </div>
              </div>
              <div className="map-detail-scroll"><ScaleCard {...cardBag(panelId)} asPanel /></div>
              {openModalId === panelId && (
                <ScaleControlModal scaleId={panelId} itemName={scales[panelId].item_name} onClose={() => setOpenModalId(null)} />
              )}
            </div>
          )}
        </div>
      )}

      {/* ─ dashboard tab ─ */}
      {activeTab === 'dashboard' && (
        <>
          <div className="dashboard-toolbar">
            <span className="toolbar-count">{scaleIds.length} item{scaleIds.length !== 1 ? 's' : ''}</span>
            <button className="btn btn-blue" onClick={() => setShowAddModal(true)}>+ Add New Item</button>
          </div>
          <main className="main">
            {scaleIds.length === 0 && (
              <div className="empty-state">
                <p>No inventory items yet.</p>
                <p>Click <strong>+ Add New Item</strong> to create your first sensor.</p>
              </div>
            )}
            {ALL_SENSOR_IDS.map(id =>
              scales[id] && ACTIVE_SENSOR_IDS.has(id)
                ? <ScaleCard key={id} {...cardBag(id)} />
                : <PlaceholderCard key={id} id={id} />
            )}
          </main>
          {showAddModal && (
            <AddItemModal addForm={addForm} setAddForm={setAddForm} addError={addError} addLoading={addLoading}
              onClose={() => { setShowAddModal(false); setAddError('') }} onAdd={addItem} />
          )}
        </>
      )}

      <footer className="footer">
        <p>inSpecter · Georgia Tech CREATE-X Capstone · Team 17</p>
        <p className="footer-sub">Real-time via Supabase Realtime WebSockets · {scaleIds.length} sensor{scaleIds.length !== 1 ? 's' : ''}</p>
      </footer>
    </div>
  )
}

// ─── ScaleCard ────────────────────────────────────────────────────────────────

function ScaleCard({
  id, scales, editCfg, setEditCfg, readings, invoices, checkouts,
  invInput, setInvInput, chkInput, setChkInput, wtInput, setWtInput,
  adjAddQty, setAdjAddQty, adjAddNote, setAdjAddNote,
  adjRemQty, setAdjRemQty, adjRemNote, setAdjRemNote,
  flash, openModalId, setOpenModalId,
  setBaseline, addInvoice, doCheckout, submitWeight,
  manualAdd, manualDiscard, saveConfig, resetScale,
  asPanel = false,
}) {
  const cfg      = scales[id]; if (!cfg) return null
  const edit     = editCfg[id] || cfg
  const totalInv = invoices[id]  || 0
  const totalChk = checkouts[id] || 0
  const raw      = readings[id] ?? null
  const isCalibrated = !!cfg.K_calibration && cfg.K_calibration > 0
  const { onShelf, inStorage, lowStock, outOfStock, overStock, unaccounted, hasBaseline, totalInventory } =
    calcMetrics(raw, cfg.tare_offset, cfg.K_calibration, totalInv, totalChk, cfg.baseline_units || 0, cfg.baseline_checkout_count || 0)
  const hasAnyAlert = outOfStock || lowStock || unaccounted > 0 || overStock

  const body = (
    <>
      {!asPanel && (
        <div className="card-top">
          <div>
            <h2 className="item-name">{cfg.item_name}</h2>
            <span className="shelf-tag">{cfg.shelf_location}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 11px' }} onClick={() => setOpenModalId(id)}>
              ⚙ Sensor Controls
            </button>
            <span className="scale-badge">{toSensorId(id)}</span>
          </div>
        </div>
      )}
      {!asPanel && openModalId === id && (
        <ScaleControlModal scaleId={id} itemName={cfg.item_name} onClose={() => setOpenModalId(null)} />
      )}

      <div className="stats">
        <div className={`stat ${outOfStock ? 'stat-empty' : overStock ? 'stat-over' : lowStock ? 'stat-low' : 'stat-shelf'}`}>
          <div className="sv">{onShelf ?? '—'}</div>
          <div className="sl">On Shelf</div>
          {onShelf !== null && <div className="ss">{overStock ? 'Above baseline' : `${onShelf} item${onShelf !== 1 ? 's' : ''}`}</div>}
        </div>
        <div className="stat"><div className="sv">{inStorage ?? '—'}</div><div className="sl">In Storage</div><div className="ss">invoice − shelf − sold</div></div>
        <div className={`stat ${!hasBaseline ? 'stat-neutral' : unaccounted > 0 ? 'stat-disc-warn' : 'stat-disc-ok'}`}>
          <div className="sv">{hasBaseline ? unaccounted : '—'}</div>
          <div className="sl">Unaccounted</div>
          <div className="ss">{!hasBaseline ? 'No baseline' : unaccounted > 0 ? 'Investigate' : 'OK'}</div>
        </div>
        <div className="stat"><div className="sv">{totalInventory ?? '—'}</div><div className="sl">Total Inventory</div><div className="ss">invoiced − sold</div></div>
        <div className="stat stat-total"><div className="sv">{totalInv}</div><div className="sl">Total Invoiced</div></div>
        <div className="stat"><div className="sv">{totalChk}</div><div className="sl">Checked Out</div></div>
      </div>

      {!isCalibrated && raw !== null && <div className="banner banner-amber">Sensor is uncalibrated — open Sensor Controls and run Tare + Calibrate to start showing unit counts.</div>}
      {isCalibrated && !hasBaseline && raw !== null && <div className="banner banner-info">Discrepancy tracking inactive. Click "Set Shelf Baseline" after stocking the shelf to start monitoring for theft and spoilage.</div>}
      {outOfStock && <div className="banner banner-red">Shelf is empty — send staff to restock from storage immediately.</div>}
      {lowStock && !outOfStock && <div className="banner banner-amber">Only {onShelf} item(s) left on shelf (threshold: 3). Restock soon.</div>}
      {unaccounted > 0 && <div className="banner banner-red">{unaccounted} item(s) removed from shelf with no POS record since last baseline. Possible cause: theft, spoilage/disposal, or misplacement to another shelf.</div>}
      {overStock && <div className="banner banner-amber">Shelf shows {onShelf} item(s) — {onShelf - (cfg.baseline_units || 0)} above the baseline of {cfg.baseline_units}. Verify the baseline is current or check for a mis-scan.</div>}

      <div className="actions">
        <div className="action-group">
          <div className="ag-label">Shelf Baseline<span className="hint"> — set after employee stocks shelf from storage</span></div>
          <div className="ag-row">
            <div className="baseline-status">
              {hasBaseline ? `Active: ${cfg.baseline_units} units placed on shelf (POS at baseline: ${cfg.baseline_checkout_count})` : 'Not set — submit a reading first, then click Set'}
            </div>
            <button className="btn btn-teal" onClick={() => setBaseline(id)}>Set Shelf Baseline</button>
          </div>
          <Flash k={id + '_base'} flash={flash} />
        </div>
        <div className="action-group">
          <div className="ag-label">Set Invoice</div>
          <div className="ag-row">
            <input type="number" min="1" placeholder="Qty received from warehouse" value={invInput[id] ?? ''}
              onChange={e => setInvInput(p => ({ ...p, [id]: e.target.value }))} onKeyDown={e => e.key === 'Enter' && addInvoice(id)} />
            <button className="btn btn-blue" onClick={() => addInvoice(id)}>+ Add Invoice</button>
          </div>
          <Flash k={id + '_inv'} flash={flash} />
        </div>
        <div className="action-group">
          <div className="ag-label">POS Checkout</div>
          <div className="ag-row">
            <input type="number" min="1" placeholder="Qty sold at register" value={chkInput[id] ?? ''}
              onChange={e => setChkInput(p => ({ ...p, [id]: e.target.value }))} onKeyDown={e => e.key === 'Enter' && doCheckout(id)} />
            <button className="btn btn-dark" onClick={() => doCheckout(id)}>Checkout</button>
          </div>
          <Flash k={id + '_pos'} flash={flash} />
        </div>
        <div className="action-group">
          <div className="ag-label">Manual Raw Value Input<span className="hint"> — LoRa auto-fills this in production</span></div>
          <div className="ag-row">
            <input type="number" step="any" placeholder="Raw load-cell value" value={wtInput[id] ?? ''}
              onChange={e => setWtInput(p => ({ ...p, [id]: e.target.value }))} onKeyDown={e => e.key === 'Enter' && submitWeight(id)} />
            <button className="btn btn-ghost" onClick={() => submitWeight(id)}>Submit</button>
          </div>
          <Flash k={id + '_wt'} flash={flash} />
        </div>
      </div>

      <details className="details-block">
        <summary>Manual Inventory Adjustment</summary>
        <div className="adj-body">
          <div className="adj-section">
            <div className="adj-section-label adj-add-label">+ Add Units</div>
            <div className="adj-hint">Use for found stock, manual restocks, or inventory count corrections upward.</div>
            <div className="ag-row">
              <input type="number" min="1" placeholder="Qty to add" className="adj-qty-input" value={adjAddQty[id] ?? ''}
                onChange={e => setAdjAddQty(p => ({ ...p, [id]: e.target.value }))} onKeyDown={e => e.key === 'Enter' && manualAdd(id)} />
              <input type="text" placeholder="Reason (e.g. Found in stockroom)" value={adjAddNote[id] ?? ''}
                onChange={e => setAdjAddNote(p => ({ ...p, [id]: e.target.value }))} onKeyDown={e => e.key === 'Enter' && manualAdd(id)} />
              <button className="btn btn-teal" onClick={() => manualAdd(id)}>+ Add</button>
            </div>
            <Flash k={id + '_adj_add'} flash={flash} />
          </div>
          <div className="adj-divider" />
          <div className="adj-section">
            <div className="adj-section-label adj-rem-label">− Discard / Remove Units</div>
            <div className="adj-hint">Use for damaged, expired, or lost items that need to be written off.</div>
            <div className="ag-row">
              <input type="number" min="1" placeholder="Qty to remove" className="adj-qty-input" value={adjRemQty[id] ?? ''}
                onChange={e => setAdjRemQty(p => ({ ...p, [id]: e.target.value }))} onKeyDown={e => e.key === 'Enter' && manualDiscard(id)} />
              <select className="adj-reason-select" value={adjRemNote[id] ?? ''} onChange={e => setAdjRemNote(p => ({ ...p, [id]: e.target.value }))}>
                <option value="">Reason (optional)</option>
                <option value="damaged">Damaged</option>
                <option value="expired">Expired / Spoiled</option>
                <option value="lost">Lost / Misplaced</option>
                <option value="count_correction">Inventory count correction</option>
                <option value="other">Other</option>
              </select>
              <button className="btn btn-danger" onClick={() => manualDiscard(id)}>Discard</button>
            </div>
            <Flash k={id + '_adj_rem'} flash={flash} />
          </div>
        </div>
      </details>

      <details className="details-block">
        <summary>Configure Sensor</summary>
        <div className="config-grid">
          <label><span>Item Name</span><input value={edit.item_name || ''} onChange={e => setEditCfg(p => ({ ...p, [id]: { ...p[id], item_name: e.target.value } }))} /></label>
          <label><span>Unit Weight (g)<span className="hint"> — only used for grams-mode calibration</span></span>
            <input type="number" value={edit.unit_weight_g || ''} onChange={e => setEditCfg(p => ({ ...p, [id]: { ...p[id], unit_weight_g: e.target.value } }))} /></label>
          <label><span>Shelf Location</span><input value={edit.shelf_location || ''} onChange={e => setEditCfg(p => ({ ...p, [id]: { ...p[id], shelf_location: e.target.value } }))} /></label>
          <label><span>Tare Offset<span className="hint"> — set via Tare button</span></span><input type="number" value={cfg.tare_offset ?? ''} readOnly /></label>
          <label><span>K Calibration (raw / unit)<span className="hint"> — set via Calibrate button</span></span><input type="number" value={cfg.K_calibration ?? ''} readOnly /></label>
          <label><span>Latest Raw Reading</span><input type="number" value={raw ?? ''} readOnly /></label>
        </div>
        <div className="config-btns">
          <button className="btn btn-blue" onClick={() => saveConfig(id)}>Save Config</button>
          <button className="btn btn-danger" onClick={() => resetScale(id)}>Reset All Data</button>
        </div>
        <Flash k={id + '_cfg'} flash={flash} />
      </details>

      <details className="details-block">
        <summary>LoRa / Pi Integration — history + snapshot writes</summary>
        <p className="api-note">From your Raspberry Pi, insert into readings for history and update the matching row for the latest snapshot. The dashboard updates live across all browsers instantly.</p>
        <pre className="code-pre">{`curl -X POST \\
  '${import.meta.env.VITE_SUPABASE_URL}/rest/v1/readings' \\
  -H 'apikey: ${import.meta.env.VITE_SUPABASE_ANON_KEY?.slice(0, 40)}...' \\
  -H 'Content-Type: application/json' \\
  -d '{"scale_id":"${id}","raw_value":123456}'

curl -X PATCH \\
  '${import.meta.env.VITE_SUPABASE_URL}/rest/v1/scales?id=eq.${id}' \\
  -H 'apikey: ${import.meta.env.VITE_SUPABASE_ANON_KEY?.slice(0, 40)}...' \\
  -H 'Content-Type: application/json' \\
  -d '{"raw_value":123456}'`}
        </pre>
      </details>
    </>
  )

  if (asPanel) return <div className="card-panel-body">{body}</div>
  return <div className={`card ${hasAnyAlert ? 'card-alert' : ''}`}>{body}</div>
}

// ─── Add Item Modal ──────────────────────────────────────────────────────────

function AddItemModal({ addForm, setAddForm, addError, addLoading, onClose, onAdd }) {
  const set = (field) => (e) => setAddForm(p => ({ ...p, [field]: e.target.value }))
  const handleKey = (e) => { if (e.key === 'Enter') onAdd() }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Add New Inventory Item</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          <div className="modal-field">
            <label>
              <span className="modal-label">Sensor ID <span className="modal-required">*</span></span>
              <input className="modal-input" placeholder="e.g. scale_3" value={addForm.id} onChange={set('id')} onKeyDown={handleKey} autoFocus />
              <span className="modal-hint">Unique identifier — must match the physical sensor node</span>
            </label>
          </div>
          <div className="modal-field">
            <label>
              <span className="modal-label">Item Name</span>
              <input className="modal-input" placeholder="e.g. Bananas" value={addForm.item_name} onChange={set('item_name')} onKeyDown={handleKey} />
            </label>
          </div>
          <div className="modal-field-row">
            <div className="modal-field">
              <label>
                <span className="modal-label">Unit Weight (g)</span>
                <input className="modal-input" type="number" min="1" placeholder="150" value={addForm.unit_weight_g} onChange={set('unit_weight_g')} onKeyDown={handleKey} />
              </label>
            </div>
            <div className="modal-field">
              <label>
                <span className="modal-label">Shelf Location</span>
                <input className="modal-input" placeholder="e.g. Produce Shelf C" value={addForm.shelf_location} onChange={set('shelf_location')} onKeyDown={handleKey} />
              </label>
            </div>
          </div>
          {addError && <div className="modal-error">{addError}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={addLoading}>Cancel</button>
          <button className="btn btn-blue" onClick={onAdd} disabled={addLoading}>{addLoading ? 'Saving…' : 'Add Item'}</button>
        </div>
      </div>
    </div>
  )
}

// ─── Placeholder card for inactive sensors ────────────────────────────────────

function PlaceholderCard({ id }) {
  const num = id.replace('scale_', '')
  return (
    <div className="card" style={{ opacity: 0.4, filter: 'grayscale(1)', pointerEvents: 'none' }}>
      <div className="card-top">
        <div>
          <h2 className="item-name" style={{ color: '#94a3b8' }}>Sensor {num} — Not connected</h2>
          <span className="shelf-tag">No hardware assigned</span>
        </div>
        <span className="scale-badge">sensor_{num}</span>
      </div>
      <div className="stats">
        {['On Shelf', 'In Storage', 'Unaccounted', 'Total Inventory', 'Total Invoiced', 'Checked Out'].map(label => (
          <div key={label} className="stat">
            <div className="sv" style={{ color: '#cbd5e1' }}>—</div>
            <div className="sl">{label}</div>
          </div>
        ))}
      </div>
      <div className="banner banner-info" style={{ opacity: 0.6 }}>
        Sensor {num} is not yet connected. Flash firmware with NODE_ID {num} and wire up to activate.
      </div>
    </div>
  )
}

// ─── Flash ───────────────────────────────────────────────────────────────────

function Flash({ k, flash }) {
  const f = flash[k]
  if (!f) return null
  return <div className={`flash flash-${f.type}`}>{f.msg}</div>
}
