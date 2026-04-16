import { useState } from 'react'
import { supabase } from './supabaseClient'

export default function ScaleControlModal({ scaleId, itemName, onClose }) {
  const [calGrams,  setCalGrams]  = useState('')
  const [itemCount, setItemCount] = useState('')
  const [status,    setStatus]    = useState(null)   // { msg, type } — for Tare/Cal
  const [avgStatus, setAvgStatus] = useState(null)   // { msg, type } — for Avg Weight
  const [busy,      setBusy]      = useState(false)

  // ── Tare / Cal helpers ───────────────────────────────────────────────────

  async function waitForDone(commandId) {
    for (let i = 0; i < 24; i++) {
      await new Promise(r => setTimeout(r, 10000))
      const { data } = await supabase
        .from('commands').select('status').eq('id', commandId).single()
      if (data?.status === 'done') {
        setStatus({ msg: '✓ Scale confirmed the command.', type: 'success' })
        setBusy(false)
        return
      }
      if (data?.status === 'failed') {
        setStatus({ msg: '✗ Scale did not respond — check Pi is running and scale is in range.', type: 'error' })
        setBusy(false)
        return
      }
      setStatus({ msg: `Waiting for Pi to relay to scale... (check ${i + 1}/24)`, type: 'info' })
    }
    setStatus({ msg: 'Timed out — Pi may be offline or scale unreachable.', type: 'error' })
    setBusy(false)
  }

  async function sendCommand(command, value = null) {
    setBusy(true)
    setStatus({ msg: 'Sending command to Pi...', type: 'info' })
    const row = { scale_id: scaleId, command, status: 'pending' }
    if (value !== null) row.value = value
    const { data, error } = await supabase
      .from('commands').insert(row).select().single()
    if (error) {
      setStatus({ msg: `Error: ${error.message}`, type: 'error' })
      setBusy(false)
      return
    }
    waitForDone(data.id)
  }

  function handleTare() {
    sendCommand('TARE')
  }

  function handleCal() {
    const g = parseFloat(calGrams)
    if (!g || g <= 0) {
      setStatus({ msg: 'Enter a valid weight in grams first.', type: 'error' })
      return
    }
    sendCommand('CAL', g)
  }

  // ── Avg weight helper ────────────────────────────────────────────────────

  async function handleCalcAvg() {
    const count = parseInt(itemCount)
    if (!count || count <= 0) {
      setAvgStatus({ msg: 'Enter how many items are on the scale.', type: 'error' })
      return
    }

    setAvgStatus({ msg: 'Reading latest weight from scale...', type: 'info' })

    const { data, error } = await supabase
      .from('readings')
      .select('weight_g, created_at')
      .eq('scale_id', scaleId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (error || !data) {
      setAvgStatus({ msg: 'No weight reading found. Make sure the scale is sending data.', type: 'error' })
      return
    }

    const totalGrams = parseFloat(data.weight_g)
    if (totalGrams <= 0) {
      setAvgStatus({ msg: 'Scale is reading 0g or negative — make sure items are on the scale and it is tared.', type: 'error' })
      return
    }

    const avgG = Math.round(totalGrams / count)

    const { error: updateError } = await supabase
      .from('scales')
      .update({ unit_weight_g: avgG })
      .eq('id', scaleId)

    if (updateError) {
      setAvgStatus({ msg: `Error saving: ${updateError.message}`, type: 'error' })
      return
    }

    const readingAge = Math.round((Date.now() - new Date(data.created_at)) / 1000)
    setAvgStatus({
      msg: `✓ Avg weight set to ${avgG}g per item (${totalGrams.toFixed(0)}g ÷ ${count} items). Reading was ${readingAge}s ago. Dashboard updated.`,
      type: 'success',
    })
    setItemCount('')
  }

  // ── Shared status color map ──────────────────────────────────────────────

  const statusColor = { info: '#0369a1', success: '#15803d', error: '#b91c1c' }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 14, padding: 28,
          width: '100%', maxWidth: 400,
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
          <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 14 }}>Tare (Zero the Scale)</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
            Remove all items from the scale first, then send.
          </div>
          <button
            onClick={handleTare}
            disabled={busy}
            className="btn btn-teal"
            style={{ opacity: busy ? 0.6 : 1 }}
          >
            Send TARE
          </button>
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '0 0 20px' }} />

        {/* ── Calibrate ── */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 14 }}>Calibrate</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
            Tare first. Place a known weight on the scale, enter the value, then send.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="number"
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
              onClick={handleCal}
              disabled={busy}
              className="btn btn-blue"
              style={{ opacity: busy ? 0.6 : 1 }}
            >
              Send CAL
            </button>
          </div>
        </div>

        {/* ── Tare/Cal status ── */}
        {status && (
          <div style={{
            fontSize: 13, padding: '10px 12px', borderRadius: 8,
            background: '#f8fafc', color: statusColor[status.type],
            marginBottom: 16,
          }}>
            {status.msg}
          </div>
        )}

        <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '0 0 20px' }} />

        {/* ── Avg Weight per Item ── */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 14 }}>Set Avg Weight per Item</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
            After taring and calibrating, place your items on the scale and wait
            for the next reading (~10s). Enter how many items are on the scale,
            then click Calculate. This updates the unit weight used for all On Shelf counts.
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input
              type="number"
              placeholder="Number of items on scale"
              value={itemCount}
              onChange={e => setItemCount(e.target.value)}
              style={{
                flex: 1, padding: '8px 10px',
                border: '1.5px solid #e2e8f0', borderRadius: 8,
                fontSize: 14,
              }}
            />
            <button
              onClick={handleCalcAvg}
              className="btn btn-dark"
            >
              Calculate
            </button>
          </div>

          {/* Avg weight status */}
          {avgStatus && (
            <div style={{
              fontSize: 13, padding: '10px 12px', borderRadius: 8,
              background: '#f8fafc', color: statusColor[avgStatus.type],
            }}>
              {avgStatus.msg}
            </div>
          )}
        </div>

        {/* ── Footer note ── */}
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
          Tare and Calibrate relay through the Pi over LoRa. Scale responds within ~30s if Pi is running.
          Avg Weight is calculated directly from the latest reading in the database — no Pi needed.
        </div>

      </div>
    </div>
  )
}
