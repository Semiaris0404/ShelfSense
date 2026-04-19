import { useState } from 'react'
import { supabase } from './supabaseClient'

// Tare and Calibrate are now pure DB writes. They read the latest raw_value
// from the readings table (sent by the Pi every ~10s) and update the scale
// row's tare_offset / K_calibration. No round-trip to the Pi is needed.

export default function ScaleControlModal({ scaleId, itemName, onClose }) {
  const [calUnits,  setCalUnits]  = useState('')
  const [calGrams,  setCalGrams]  = useState('')
  const [tareStat,  setTareStat]  = useState(null)
  const [calStat,   setCalStat]   = useState(null)
  const [busy,      setBusy]      = useState(false)

  async function fetchLatestRaw() {
    const { data, error } = await supabase
      .from('readings')
      .select('raw_value, created_at')
      .eq('scale_id', scaleId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    if (error || !data) return { error: 'No raw reading found. Make sure the scale is sending data.' }
    const raw = parseFloat(data.raw_value)
    if (isNaN(raw)) return { error: 'Latest reading is not a valid number.' }
    const ageS = Math.round((Date.now() - new Date(data.created_at)) / 1000)
    return { raw, ageS }
  }

  async function handleTare() {
    setBusy(true)
    setTareStat({ msg: 'Reading latest raw value...', type: 'info' })
    const { raw, ageS, error } = await fetchLatestRaw()
    if (error) { setTareStat({ msg: error, type: 'error' }); setBusy(false); return }

    const { error: upErr } = await supabase
      .from('scales').update({ tare_offset: raw }).eq('id', scaleId)
    setBusy(false)
    if (upErr) { setTareStat({ msg: `Error saving: ${upErr.message}`, type: 'error' }); return }
    setTareStat({ msg: `✓ Tare set to ${raw} (reading was ${ageS}s ago).`, type: 'success' })
  }

  async function handleCalUnits() {
    const n = parseInt(calUnits)
    if (!n || n <= 0) { setCalStat({ msg: 'Enter how many units are on the scale.', type: 'error' }); return }

    setBusy(true)
    setCalStat({ msg: 'Reading latest raw value...', type: 'info' })

    const { data: scaleRow, error: scaleErr } = await supabase
      .from('scales').select('tare_offset').eq('id', scaleId).single()
    if (scaleErr || !scaleRow) { setCalStat({ msg: 'Could not load scale config.', type: 'error' }); setBusy(false); return }
    const tare = scaleRow.tare_offset ?? 0

    const { raw, ageS, error } = await fetchLatestRaw()
    if (error) { setCalStat({ msg: error, type: 'error' }); setBusy(false); return }

    const delta = raw - tare
    if (delta <= 0) { setCalStat({ msg: `Raw (${raw}) ≤ tare offset (${tare}). Re-tare with the shelf empty, then put items back.`, type: 'error' }); setBusy(false); return }

    const K = delta / n
    const { error: upErr } = await supabase
      .from('scales').update({ K_calibration: K }).eq('id', scaleId)
    setBusy(false)
    if (upErr) { setCalStat({ msg: `Error saving: ${upErr.message}`, type: 'error' }); return }
    setCalStat({
      msg: `✓ K = ${K.toFixed(2)} raw/unit (${delta.toFixed(0)} ÷ ${n} units, reading ${ageS}s ago).`,
      type: 'success',
    })
    setCalUnits('')
  }

  async function handleCalGrams() {
    const g = parseFloat(calGrams)
    if (!g || g <= 0) { setCalStat({ msg: 'Enter a known weight in grams.', type: 'error' }); return }

    setBusy(true)
    setCalStat({ msg: 'Reading latest raw value...', type: 'info' })

    const { data: scaleRow, error: scaleErr } = await supabase
      .from('scales').select('tare_offset, unit_weight_g').eq('id', scaleId).single()
    if (scaleErr || !scaleRow) { setCalStat({ msg: 'Could not load scale config.', type: 'error' }); setBusy(false); return }
    const tare = scaleRow.tare_offset ?? 0
    const gramsPerUnit = parseFloat(scaleRow.unit_weight_g)
    if (!gramsPerUnit || gramsPerUnit <= 0) {
      setCalStat({ msg: 'Set "Unit Weight (g)" in Configure first — grams-mode needs grams-per-unit.', type: 'error' })
      setBusy(false); return
    }

    const { raw, ageS, error } = await fetchLatestRaw()
    if (error) { setCalStat({ msg: error, type: 'error' }); setBusy(false); return }

    const delta = raw - tare
    if (delta <= 0) { setCalStat({ msg: `Raw (${raw}) ≤ tare offset (${tare}). Re-tare with the shelf empty.`, type: 'error' }); setBusy(false); return }

    // counts_per_gram = delta / g  →  K = counts_per_gram * grams_per_unit
    const K = delta * gramsPerUnit / g
    const { error: upErr } = await supabase
      .from('scales').update({ K_calibration: K }).eq('id', scaleId)
    setBusy(false)
    if (upErr) { setCalStat({ msg: `Error saving: ${upErr.message}`, type: 'error' }); return }
    setCalStat({
      msg: `✓ K = ${K.toFixed(2)} raw/unit (from ${g}g known mass × ${gramsPerUnit}g/unit, reading ${ageS}s ago).`,
      type: 'success',
    })
    setCalGrams('')
  }

  const statusColor = { info: '#0369a1', success: '#15803d', error: '#b91c1c' }

  const StatusBox = ({ s }) => s ? (
    <div style={{
      fontSize: 13, padding: '10px 12px', borderRadius: 8,
      background: '#f8fafc', color: statusColor[s.type], marginTop: 8,
    }}>{s.msg}</div>
  ) : null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="scale-modal-box"
        style={{
          background: '#fff', borderRadius: 14, padding: 28,
          width: '100%', maxWidth: 420,
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          maxHeight: '90vh', overflowY: 'auto',
        }}
      >
        {/* ── Header ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>Scale Controls</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{itemName} · {scaleId}</div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#94a3b8', lineHeight: 1 }}
          >✕</button>
        </div>

        {/* ── Tare ── */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 14 }}>1. Tare (Zero the Scale)</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
            Remove all items from the shelf, wait for the next raw reading (~10s), then click Tare.
            This snapshots the current raw value as the zero point.
          </div>
          <button
            onClick={handleTare}
            disabled={busy}
            className="btn btn-teal"
            style={{ opacity: busy ? 0.6 : 1 }}
          >
            Tare Now
          </button>
          <StatusBox s={tareStat} />
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '0 0 20px' }} />

        {/* ── Calibrate by units (primary) ── */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 14 }}>2. Calibrate (by units)</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
            Tare first. Then place a known number of items on the shelf, wait ~10s, enter the count and click Calibrate.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="number"
              min="1"
              placeholder="Number of items on scale"
              value={calUnits}
              onChange={e => setCalUnits(e.target.value)}
              disabled={busy}
              style={{
                flex: 1, padding: '8px 10px',
                border: '1.5px solid #e2e8f0', borderRadius: 8,
                fontSize: 14,
              }}
            />
            <button
              onClick={handleCalUnits}
              disabled={busy}
              className="btn btn-blue"
              style={{ opacity: busy ? 0.6 : 1 }}
            >
              Calibrate
            </button>
          </div>
        </div>

        {/* ── Calibrate by grams (optional) ── */}
        <details style={{ marginBottom: 16 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
            Optional: Calibrate by known mass (grams)
          </summary>
          <div style={{ fontSize: 12, color: '#6b7280', margin: '8px 0 10px' }}>
            Use a calibration weight instead of counting units. Requires "Unit Weight (g)" to be set in Configure.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="number"
              min="1"
              placeholder="Known weight (grams)"
              value={calGrams}
              onChange={e => setCalGrams(e.target.value)}
              disabled={busy}
              style={{
                flex: 1, padding: '8px 10px',
                border: '1.5px solid #e2e8f0', borderRadius: 8,
                fontSize: 14,
              }}
            />
            <button
              onClick={handleCalGrams}
              disabled={busy}
              className="btn btn-dark"
              style={{ opacity: busy ? 0.6 : 1 }}
            >
              Calibrate
            </button>
          </div>
        </details>

        <StatusBox s={calStat} />

        {/* ── Footer note ── */}
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 16 }}>
          Tare and Calibrate run entirely against the database — no Pi round-trip.
          Make sure the Pi has sent at least one raw reading first.
        </div>
      </div>
    </div>
  )
}
