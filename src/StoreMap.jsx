import { useState } from 'react'
import './StoreMap.css'

// ── Which scales have real hardware ──────────────────────────────────────────
const ACTIVE_IDS  = new Set(['scale_1', 'scale_2'])
const ALL_SCALE_IDS = ['scale_1', 'scale_2', 'scale_3', 'scale_4', 'scale_5', 'scale_6']

const GRAY = { fill: '#f1f5f9', stroke: '#94a3b8', text: '#64748b' }
const SECTION_COLORS = {
  Produce:   { fill: '#dcfce7', stroke: '#16a34a', text: '#14532d' },
  Dairy:     GRAY, Snacks: GRAY, Beverages: GRAY,
  Beauty:    GRAY, Household: GRAY, Entrance: GRAY, Checkout: GRAY,
}

const FLOOR_SECTIONS = [
  { id: 'entrance',  label: 'Entrance',  x: 35, y: 4,  w: 30, h: 10, section: 'Entrance'  },
  { id: 'produce',   label: 'Produce',   x: 10, y: 20, w: 60, h: 22, section: 'Produce'   },
  { id: 'dairy',     label: 'Dairy',     x: 72, y: 20, w: 20, h: 36, section: 'Dairy'     },
  { id: 'snacks',    label: 'Snacks',    x: 42, y: 50, w: 28, h: 18, section: 'Snacks'    },
  { id: 'beverages', label: 'Beverages', x: 10, y: 50, w: 26, h: 18, section: 'Beverages' },
  { id: 'beauty',    label: 'Beauty',    x: 10, y: 72, w: 26, h: 18, section: 'Beauty'    },
  { id: 'household', label: 'Household', x: 42, y: 72, w: 28, h: 18, section: 'Household' },
  { id: 'checkout',  label: 'Checkout',  x: 10, y: 4,  w: 22, h: 10, section: 'Checkout'  },
]

const PRODUCE   = FLOOR_SECTIONS.find(s => s.section === 'Produce')
const TAG_W     = 14
const TAG_H     = 4
const GAP       = 3
const ROW_SIZE  = 3   // 3 tags per row

// Row 0 = TOP edge of Produce, Row 1 = BOTTOM edge
// index 0,1,2 → top row (scale_1,2,3)
// index 3,4,5 → bottom row (scale_4,5,6)
const getTagGeom = (index, total) => {
  const isBottom  = index >= ROW_SIZE
  const rowIndex  = isBottom ? index - ROW_SIZE : index
  const rowCount  = isBottom
    ? Math.max(0, total - ROW_SIZE)
    : Math.min(total, ROW_SIZE)

  const totalRowWidth = rowCount * TAG_W + Math.max(0, rowCount - 1) * GAP
  const startX = PRODUCE.x + (PRODUCE.w - totalRowWidth) / 2
  const cx = startX + rowIndex * (TAG_W + GAP) + TAG_W / 2

  const EDGE_PAD = 1.5
  // Top row: tag sits just below the top edge of Produce
  // Bottom row: tag sits just above the bottom edge of Produce
  const y0 = isBottom
    ? PRODUCE.y + PRODUCE.h - TAG_H - EDGE_PAD
    : PRODUCE.y + EDGE_PAD

  return { cx, cy: y0 + TAG_H / 2, x0: cx - TAG_W / 2, y0, isBottom }
}

export default function StoreMap({ scales, readings, checkouts, invoices, selectedNodeId, onNodeSelect }) {
  const [hoveredId, setHoveredId] = useState(null)

  // Build nodes in fixed order 1→6, placeholders for missing/inactive
  const allNodes = ALL_SCALE_IDS.map(id => {
    const cfg       = (scales || {})[id]
    const isActive  = ACTIVE_IDS.has(id)

    if (!cfg || !isActive) {
      return {
        id,
        item: `Scale ${id.split('_')[1]}`,
        onShelf: null, inStorage: null,
        totalChk: 0, totalInv: 0,
        lowStock: false, raw: null,
        isPlaceholder: true,
      }
    }

    const raw      = readings?.[id] ?? null
    const K        = cfg.K_calibration
    const onShelf  = (raw !== null && K && K > 0)
      ? Math.max(0, Math.round((raw - (cfg.tare_offset || 0)) / K))
      : null
    const totalInv  = invoices?.[id]  || 0
    const totalChk  = checkouts?.[id] || 0
    const inStorage = onShelf !== null ? Math.max(0, totalInv - onShelf - totalChk) : null
    const lowStock  = onShelf !== null && onShelf <= 3
    return { id, item: cfg.item_name, onShelf, inStorage, totalChk, totalInv, lowStock, raw, isPlaceholder: false }
  })

  const nodeColor = (node) => {
    if (node.isPlaceholder)    return '#cbd5e1'  // light gray — unused
    if (node.onShelf === null) return '#94a3b8'  // dark gray — no reading yet
    if (node.onShelf === 0)    return '#dc2626'  // red — empty
    if (node.lowStock)         return '#d97706'  // amber — low stock
    return '#16a34a'                             // green — OK
  }

  return (
    <div className="map-wrap">
      <div className="map-legend">
        <span className="leg-item"><span className="leg-rect" style={{ background: '#16a34a' }} />OK</span>
        <span className="leg-item"><span className="leg-rect" style={{ background: '#d97706' }} />Low stock</span>
        <span className="leg-item"><span className="leg-rect" style={{ background: '#dc2626' }} />Empty</span>
        <span className="leg-item"><span className="leg-rect" style={{ background: '#94a3b8' }} />No reading yet</span>
        <span className="leg-item"><span className="leg-rect" style={{ background: '#cbd5e1' }} />Not connected</span>
        <span className="leg-item leg-hint">Click a shelf tag to view details</span>
      </div>

      <div className="map-container" onClick={() => onNodeSelect?.(null)}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" className="map-svg">

          {/* Floor sections */}
          {FLOOR_SECTIONS.map(sec => {
            const c = SECTION_COLORS[sec.section] || GRAY
            return (
              <g key={sec.id}>
                <rect x={sec.x} y={sec.y} width={sec.w} height={sec.h}
                  rx="1.5" fill={c.fill} stroke={c.stroke} strokeWidth="0.4" />
                <text x={sec.x + sec.w / 2} y={sec.y + sec.h / 2}
                  textAnchor="middle" dominantBaseline="central"
                  fontSize="2.8" fontWeight="600" fill={c.text} opacity="0.7">
                  {sec.label}
                </text>
              </g>
            )
          })}

          {/* Separator lines between adjacent tags on same row */}
          {allNodes.map((_, i) => {
            if (i === 0) return null
            const prev = getTagGeom(i - 1, allNodes.length)
            const curr = getTagGeom(i,     allNodes.length)
            if (prev.isBottom !== curr.isBottom) return null
            const sepX = (prev.x0 + TAG_W + curr.x0) / 2
            const lineY1 = curr.isBottom ? PRODUCE.y + PRODUCE.h - 6  : PRODUCE.y + 0.5
            const lineY2 = curr.isBottom ? PRODUCE.y + PRODUCE.h - 0.5 : PRODUCE.y + TAG_H + 1.5
            return (
              <line key={`sep-${i}`}
                x1={sepX} y1={lineY1} x2={sepX} y2={lineY2}
                stroke={SECTION_COLORS.Produce.stroke} strokeWidth="0.25"
                strokeDasharray="1.2,1" opacity="0.4" />
            )
          })}

          {/* Scale shelf tags */}
          {allNodes.map((node, i) => {
            const color      = nodeColor(node)
            const isHovered  = hoveredId === node.id
            const isSelected = selectedNodeId === node.id
            const { x0, y0, cx, cy } = getTagGeom(i, allNodes.length)
            const truncName  = node.item.length > 12 ? node.item.slice(0, 11) + '…' : node.item

            return (
              <g key={node.id}
                style={{
                  cursor: node.isPlaceholder ? 'default' : 'pointer',
                  filter: isHovered && !isSelected && !node.isPlaceholder ? 'brightness(1.15)' : 'none',
                  transition: 'filter 0.15s',
                }}
                onMouseEnter={() => !node.isPlaceholder && setHoveredId(node.id)}
                onMouseLeave={() => setHoveredId(null)}
                onTouchStart={e => { e.preventDefault(); if (!node.isPlaceholder) onNodeSelect?.(isSelected ? null : node) }}
                onClick={e => { e.stopPropagation(); if (!node.isPlaceholder) onNodeSelect?.(isSelected ? null : node) }}
              >
                {isSelected && (
                  <rect x={x0 - 1.3} y={y0 - 1.3} width={TAG_W + 2.6} height={TAG_H + 2.6}
                    rx="1.3" fill="none" stroke={color} strokeWidth="0.85" opacity="0.9" />
                )}
                {isHovered && !isSelected && !node.isPlaceholder && (
                  <rect x={x0 - 0.8} y={y0 - 0.8} width={TAG_W + 1.6} height={TAG_H + 1.6}
                    rx="1.2" fill="none" stroke={color} strokeWidth="0.5" opacity="0.6"
                    strokeDasharray="1.2,0.8" />
                )}
                <rect x={x0} y={y0} width={TAG_W} height={TAG_H}
                  rx="0.8" fill={color} stroke="white"
                  strokeWidth={isSelected ? 0.55 : 0.28}
                  opacity={node.isPlaceholder ? 0.5 : 1} />
                <text x={cx} y={cy}
                  textAnchor="middle" dominantBaseline="central"
                  fontSize="1.7" fill={node.isPlaceholder ? '#64748b' : 'white'}
                  fontWeight="700" style={{ pointerEvents: 'none' }}>
                  {truncName}
                </text>
                <text
                  x={cx}
                  y={isBottom ? y0 - 1.4 : y0 + TAG_H + 1.8}
                  textAnchor="middle"
                  fontSize="1.5" fill={node.isPlaceholder ? '#94a3b8' : color}
                  fontWeight="600" style={{ pointerEvents: 'none' }}>
                  {node.id}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
