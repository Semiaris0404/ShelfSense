import { useState } from 'react'
import { supabase } from './supabaseClient'

export default function ScaleControlModal({ scaleId, itemName, onClose }) {
  const [calGrams, setCalGrams] = useState('')
  const [status,   setStatus]   = useState(null)  // { msg, type }
  const [busy,     setBusy]     = useState(false)

  async function waitForDone(commandId) {
    // Poll every 10s for up to 4 minutes
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
      // still pending — update waiting message with countdown
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

  const statusColor = { info: '#0369a1', success: '#15803d', error: '#b91c1c' }

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
        }}
      >
        {/* Header */}
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

        {/* Tare */}
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

        {/* Calibrate */}
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

        {/* Status */}
        {status && (
          <div style={{
            fontSize: 13, padding: '10px 12px', borderRadius: 8,
            background: '#f8fafc', color: statusColor[status.type],
            marginTop: 4,
          }}>
            {status.msg}
          </div>
        )}

        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 16 }}>
          Commands relay through the Pi over LoRa. Scale responds within ~30s if Pi is running.
        </div>
      </div>
    </div>
  )
}
