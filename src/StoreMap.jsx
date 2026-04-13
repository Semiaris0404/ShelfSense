import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabaseClient'
import './StoreMap.css'

// ─── Static "dummy" scale nodes (fixed items, no live scale) ─────────────────
// To add a real scale later: move it out of STATIC_NODES into SCALE_IDS in App.jsx
// and give it a real scale_id. Shape: { id, label, item, count, unit, x, y, section }
const STATIC_NODES = [
  { id: 's3',  label: 'Shelf C', item: 'Bananas',     count: 24, unit: 'bunches', x: 38,  y: 34, section: 'Produce'    },
  { id: 's4',  label: 'Shelf D', item: 'Strawberries', count: 18, unit: 'packs',  x: 55,  y: 34, section: 'Produce'    },
  { id: 's5',  label: 'Shelf E', item: 'Whole Milk',  count: 32, unit: 'gallons', x: 78,  y: 28, section: 'Dairy'      },
  { id: 's6',  label: 'Shelf F', item: 'Orange Juice',count: 20, unit: 'bottles', x: 78,  y: 44, section: 'Dairy'      },
  { id: 's7',  label: 'Shelf G', item: 'Potato Chips',count: 40, unit: 'bags',    x: 62,  y: 62, section: 'Snacks'     },
  { id: 's8',  label: 'Shelf H', item: 'Sparkling Water',count:36,unit:'bottles', x: 22,  y: 60, section: 'Beverages'  },
  { id: 's9',  label: 'Shelf I', item: 'Shampoo',     count: 15, unit: 'bottles', x: 22,  y: 80, section: 'Beauty'     },
  { id: 's10', label: 'Shelf J', item: 'Paper Towels',count: 22, unit: 'rolls',   x: 62,  y: 80, section: 'Household'  },
]

// ─── Section color map ───────────────────────────────────────────────────────
const SECTION_COLORS = {
  Produce:    { fill: '#dcfce7', stroke: '#16a34a', text: '#14532d' },
  Dairy:      { fill: '#dbeafe', stroke: '#2563eb', text: '#1e3a8a' },
  Snacks:     { fill: '#fef9c3', stroke: '#ca8a04', text: '#713f12' },
  Beverages:  { fill: '#e0f2fe', stroke: '#0891b2', text: '#0c4a6e' },
  Beauty:     { fill: '#fce7f3', stroke: '#db2777', text: '#831843' },
  Household:  { fill: '#ede9fe', stroke: '#7c3aed', text: '#3b0764' },
  Entrance:   { fill: '#f1f5f9', stroke: '#94a3b8', text: '#475569' },
  Checkout:   { fill: '#fef2f2', stroke: '#dc2626', text: '#7f1d1d' },
}

// ─── Store floor plan sections (x,y,w,h all in %) ───────────────────────────
const FLOOR_SECTIONS = [
  { id: 'entrance',   label: 'Entrance',   x: 35, y: 4,  w: 30, h: 10, section: 'Entrance'  },
  { id: 'produce',    label: 'Produce',    x: 10, y: 20, w: 60, h: 22, section: 'Produce'   },
  { id: 'dairy',      label: 'Dairy',      x: 72, y: 20, w: 20, h: 36, section: 'Dairy'     },
  { id: 'snacks',     label: 'Snacks',     x: 42, y: 50, w: 30, h: 18, section: 'Snacks'    },
  { id: 'beverages',  label: 'Beverages',  x: 10, y: 50, w: 26, h: 18, section: 'Beverages' },
  { id: 'beauty',     label: 'Beauty',     x: 10, y: 72, w: 26, h: 18, section: 'Beauty'    },
  { id: 'household',  label: 'Household',  x: 42, y: 72, w: 30, h: 18, section: 'Household' },
  { id: 'checkout',   label: 'Checkout',   x: 10, y: 4,  w: 22, h: 10, section: 'Checkout'  },
]

// ─── Live scale positions (must match SCALE_IDS in App.jsx) ─────────────────
const LIVE_SCALE_POSITIONS = {
  scale_1: { x: 22, y: 28, label: 'Shelf A', section: 'Produce' },
  scale_2: { x: 38, y: 50, label: 'Shelf B — wait, wrong', section: 'Produce' },
}
// Override with correct positions
const LIVE_POSITIONS = {
  scale_1: { x: 22, y: 28, label: 'Scale A', section: 'Produce'  },
  scale_2: { x: 55, y: 50, label: 'Scale B', section: 'Snacks'   },
}

export default function StoreMap({ scales, readings, checkouts, invoices }) {
  const [activeNode, setActiveNode] = useState(null)
  const [popupPos,   setPopupPos]   = useState({ x: 0, y: 0 })
  const mapRef = useRef(null)

  // Build live node data from props passed from App.jsx
  const liveNodes = Object.entries(scales || {}).map(([id, cfg]) => {
    const pos       = LIVE_POSITIONS[id] || { x: 50, y: 50, label: id, section: 'Produce' }
    const wt        = readings?.[id] ?? null
    const unitW     = cfg.unit_weight_g || 1
    const onShelf   = wt !== null ? Math.max(0, Math.round(wt / unitW)) : null
    const totalInv  = invoices?.[id]  || 0
    const totalChk  = checkouts?.[id] || 0
    const inStorage = onShelf !== null ? Math.max(0, totalInv - onShelf - totalChk) : null
    const lowStock  = onShelf !== null && onShelf <= 3
    const isLive    = true
    return {
      id, label: pos.label, item: cfg.item_name,
      onShelf, inStorage, totalChk, totalInv,
      unit: 'items', x: pos.x, y: pos.y,
      section: cfg.shelf_location || pos.section,
      isLive, lowStock, wt,
    }
  })

  const allNodes = [...liveNodes, ...STATIC_NODES]

  // ── pointer handling (works for mouse and touch) ────────────────────────

  const handleNodeEnter = (node, e) => {
    setActiveNode(node)
    updatePopupPos(e)
  }

  const handleNodeLeave = () => setActiveNode(null)

  const handleNodeTouch = (node, e) => {
    e.preventDefault()
    if (activeNode?.id === node.id) { setActiveNode(null); return }
    setActiveNode(node)
    updatePopupPos(e.touches[0])
  }

  const updatePopupPos = (e) => {
    if (!mapRef.current) return
    const rect = mapRef.current.getBoundingClientRect()
    setPopupPos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    })
  }

  const handleMouseMove = (e) => {
    if (activeNode) updatePopupPos(e)
  }

  // ── shelf status color ──────────────────────────────────────────────────

  const nodeColor = (node) => {
    if (!node.isLive) return '#64748b'
    if (node.onShelf === null)  return '#94a3b8'
    if (node.onShelf === 0)     return '#dc2626'
    if (node.lowStock)          return '#d97706'
    return '#16a34a'
  }

  return (
    <div className="map-wrap">

      {/* ── legend ── */}
      <div className="map-legend">
        <span className="leg-item"><span className="leg-dot" style={{ background: '#16a34a' }} />Live · OK</span>
        <span className="leg-item"><span className="leg-dot" style={{ background: '#d97706' }} />Live · Low stock</span>
        <span className="leg-item"><span className="leg-dot" style={{ background: '#dc2626' }} />Live · Empty</span>
        <span className="leg-item"><span className="leg-dot leg-static" />Static item</span>
        <span className="leg-item leg-hint">Hover or tap a dot for details</span>
      </div>

      {/* ── map ── */}
      <div
        className="map-container"
        ref={mapRef}
        onMouseMove={handleMouseMove}
        onClick={() => setActiveNode(null)}
      >
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid meet"
          className="map-svg"
        >
          {/* Floor sections */}
          {FLOOR_SECTIONS.map(sec => {
            const c = SECTION_COLORS[sec.section] || SECTION_COLORS.Entrance
            return (
              <g key={sec.id}>
                <rect
                  x={sec.x} y={sec.y} width={sec.w} height={sec.h}
                  rx="1.5"
                  fill={c.fill} stroke={c.stroke} strokeWidth="0.4"
                />
                <text
                  x={sec.x + sec.w / 2} y={sec.y + sec.h / 2}
                  textAnchor="middle" dominantBaseline="central"
                  fontSize="2.8" fontWeight="600" fill={c.text} opacity="0.7"
                >
                  {sec.label}
                </text>
              </g>
            )
          })}

          {/* Aisle lines */}
          <line x1="10" y1="44" x2="70" y2="44" stroke="#cbd5e1" strokeWidth="0.3" strokeDasharray="1,1" />
          <line x1="36" y1="20" x2="36" y2="42" stroke="#cbd5e1" strokeWidth="0.3" strokeDasharray="1,1" />

          {/* Entrance arrow */}
          <polygon points="50,13 48,16 52,16" fill="#64748b" opacity="0.5" />
          <line x1="50" y1="16" x2="50" y2="20" stroke="#64748b" strokeWidth="0.4" opacity="0.5" />

          {/* Scale nodes */}
          {allNodes.map(node => {
            const color   = nodeColor(node)
            const isActive = activeNode?.id === node.id
            const isLive   = node.isLive
            return (
              <g
                key={node.id}
                style={{ cursor: 'pointer' }}
                onMouseEnter={e => handleNodeEnter(node, e)}
                onMouseLeave={handleNodeLeave}
                onTouchStart={e => handleNodeTouch(node, e)}
              >
                {/* Pulse ring for live nodes */}
                {isLive && (
                  <circle
                    cx={node.x} cy={node.y} r={isActive ? 3.5 : 2.8}
                    fill="none" stroke={color} strokeWidth="0.5"
                    opacity={isActive ? 0.8 : 0.4}
                    className="pulse-ring"
                  />
                )}
                {/* Main dot */}
                <circle
                  cx={node.x} cy={node.y}
                  r={isActive ? 2.2 : 1.8}
                  fill={isLive ? color : '#64748b'}
                  stroke="white" strokeWidth="0.4"
                  opacity={isLive ? 1 : 0.7}
                />
                {/* Label below dot */}
                <text
                  x={node.x} y={node.y + 3.2}
                  textAnchor="middle" fontSize="1.8"
                  fill={isLive ? color : '#64748b'}
                  fontWeight={isLive ? '700' : '400'}
                >
                  {node.label}
                </text>
              </g>
            )
          })}
        </svg>

        {/* ── Popup ── */}
        {activeNode && (
          <div
            className="map-popup"
            style={{
              left: Math.min(popupPos.x + 12, (mapRef.current?.offsetWidth || 400) - 220),
              top:  Math.max(popupPos.y - 20, 8),
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="popup-header">
              <span className="popup-label">{activeNode.label}</span>
              {activeNode.isLive && (
                <span className="popup-live-badge">LIVE</span>
              )}
            </div>
            <div className="popup-item">{activeNode.item}</div>

            {activeNode.isLive ? (
              <div className="popup-stats">
                <div className="popup-row">
                  <span>On Shelf</span>
                  <strong style={{ color: activeNode.onShelf === 0 ? '#dc2626' : activeNode.lowStock ? '#d97706' : '#16a34a' }}>
                    {activeNode.onShelf ?? '—'}
                  </strong>
                </div>
                <div className="popup-row">
                  <span>In Storage</span>
                  <strong>{activeNode.inStorage ?? '—'}</strong>
                </div>
                <div className="popup-row">
                  <span>Checked Out</span>
                  <strong>{activeNode.totalChk}</strong>
                </div>
                {activeNode.wt !== null && (
                  <div className="popup-row">
                    <span>Scale Reading</span>
                    <strong>{activeNode.wt?.toFixed(0)}g</strong>
                  </div>
                )}
                {activeNode.lowStock && activeNode.onShelf > 0 && (
                  <div className="popup-warn">Low stock — restock soon</div>
                )}
                {activeNode.onShelf === 0 && (
                  <div className="popup-warn popup-empty">Shelf empty!</div>
                )}
              </div>
            ) : (
              <div className="popup-stats">
                <div className="popup-row">
                  <span>Count</span>
                  <strong>{activeNode.count} {activeNode.unit}</strong>
                </div>
                <div className="popup-row">
                  <span>Section</span>
                  <strong>{activeNode.section}</strong>
                </div>
                <div className="popup-static-note">Static — no live scale</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
