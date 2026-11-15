/**
 * Draws one simulation screen. Used two ways:
 *  - PlayScreen: the trainee interacts with it (Player page).
 *  - EditScreen: the author draws, moves and resizes elements (Editor page).
 * Element rects are percentages, so the screen scales to any size.
 * With a screenshot, controls are transparent overlays on the image; without one
 * they render as a simple wireframe UI.
 */
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import { fieldVar, interpolate, isVisible } from "../../shared/engine";
import { snapRect } from "../../shared/layout";
import { formatValue, parseTableVar } from "../../shared/personas";
import type { Rect, Screen, SimElement } from "../../shared/schema";
import { assetUrl } from "../api";

const rectStyle = (r: Rect): CSSProperties => ({ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` });

function Frame({ screen, children, frameRef, onPointerDown, className = "" }: {
  screen: Screen;
  children: React.ReactNode;
  frameRef?: React.Ref<HTMLDivElement>;
  onPointerDown?: (e: RPointerEvent<HTMLDivElement>) => void;
  className?: string;
}) {
  const hasImage = !!screen.imageAssetId;
  return (
    <div
      ref={frameRef}
      className={`screen-frame ${hasImage ? "has-image" : "wireframe"} ${className}`}
      style={{ aspectRatio: String(screen.aspect) }}
      onPointerDown={onPointerDown}
    >
      {hasImage && <img className="screen-image" src={assetUrl(screen.imageAssetId!)} alt={screen.name} draggable={false} />}
      {children}
    </div>
  );
}

// ------------------------------------------------------------------ play

function FieldControl({ el, value, onCommit, disabled }: {
  el: SimElement;
  value: string;
  onCommit: (v: string) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value || el.kind !== "input") onCommit(draft);
  };
  switch (el.kind) {
    case "input":
      return (
        <input
          className="sim-field"
          value={draft}
          placeholder={el.placeholder}
          aria-label={el.label}
          disabled={disabled}
          type={/password/i.test(el.label + el.id) ? "password" : "text"}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft !== value && onCommit(draft)}
          onKeyDown={(e) => e.key === "Enter" && onCommit(draft)}
        />
      );
    case "textarea":
      return (
        <textarea
          className="sim-field"
          value={draft}
          placeholder={el.placeholder}
          aria-label={el.label}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft !== value && commit()}
        />
      );
    case "select":
      return (
        <select className="sim-field" value={value} aria-label={el.label} disabled={disabled} onChange={(e) => onCommit(e.target.value)}>
          {!(el.options ?? []).includes(value) && <option value={value}>{value || "Select…"}</option>}
          {(el.options ?? []).map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      );
    case "checkbox":
      return (
        <label className="sim-check">
          <input type="checkbox" checked={value === "true"} disabled={disabled} onChange={(e) => onCommit(String(e.target.checked))} />
          <span>{el.label}</span>
        </label>
      );
    default:
      return null;
  }
}

export interface PlayScreenProps {
  screen: Screen;
  vars: Record<string, string>;
  /** Element to highlight (guided mode). */
  highlightId?: string | null;
  /** Dim everything except the highlight. */
  focusHighlight?: boolean;
  /** Outline clickable areas on screenshots. */
  revealHotspots?: boolean;
  onActivate: (el: SimElement) => void;
  onCommit: (el: SimElement, value: string) => void;
}

export function PlayScreen({ screen, vars, highlightId, focusHighlight, revealHotspots, onActivate, onCommit }: PlayScreenProps) {
  return (
    <Frame screen={screen} className={`${revealHotspots ? "reveal" : ""} ${focusHighlight && highlightId ? "focus-mode" : ""}`}>
      {screen.elements
        .filter((el) => isVisible(el, vars))
        .map((el) => {
          const label = interpolate(el.label, vars);
          const cls = `sim-el kind-${el.kind} ${el.id === highlightId ? "highlight" : ""}`;
          if (el.kind === "table") {
            const table = parseTableVar(vars[el.tableSource ?? ""]);
            return (
              <div key={el.id} className={cls} style={rectStyle(el.rect)}>
                <div className="sim-table-wrap">
                  {table && table.rows.length ? (
                    <table className="sim-table" aria-label={label}>
                      <thead><tr>{table.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
                      <tbody>
                        {table.rows.map((r, i) => (
                          <tr key={i}>{table.columns.map((c) => <td key={c.key} className={c.type === "money" || c.type === "number" ? "num" : ""}>{formatValue(r[c.key] ?? "", c.type)}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="sim-table-empty">{table ? "No records" : "—"}</div>
                  )}
                </div>
              </div>
            );
          }
          if (el.kind === "text") {
            return (
              <div key={el.id} className={cls} style={rectStyle(el.rect)}>
                {label}
              </div>
            );
          }
          if (el.kind === "input" || el.kind === "textarea" || el.kind === "select" || el.kind === "checkbox") {
            return (
              <div key={el.id} className={cls} style={rectStyle(el.rect)}>
                <FieldControl el={el} value={vars[fieldVar(el)] ?? ""} onCommit={(v) => onCommit(el, v)} />
              </div>
            );
          }
          return (
            <button key={el.id} type="button" className={cls} style={rectStyle(el.rect)} title={label} onClick={() => onActivate(el)}>
              <span className="sim-label">{label}</span>
            </button>
          );
        })}
    </Frame>
  );
}

// ------------------------------------------------------------------ edit

type Drag =
  | { kind: "draw"; startX: number; startY: number; rect: Rect }
  | { kind: "move" | "resize"; id: string; startX: number; startY: number; orig: Rect };

export interface EditScreenProps {
  screen: Screen;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRectChange: (id: string, rect: Rect) => void;
  onCreate: (rect: Rect) => void;
}

const round = (n: number) => Math.round(n * 10) / 10;
const clampRect = (r: Rect): Rect => {
  const w = Math.min(100, Math.max(1, r.w));
  const h = Math.min(100, Math.max(1, r.h));
  return { x: round(Math.min(100 - w, Math.max(0, r.x))), y: round(Math.min(100 - h, Math.max(0, r.y))), w: round(w), h: round(h) };
};

export function EditScreen({ screen, selectedId, onSelect, onRectChange, onCreate }: EditScreenProps) {
  const frame = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });

  const pct = (e: { clientX: number; clientY: number }) => {
    const b = frame.current!.getBoundingClientRect();
    return { x: ((e.clientX - b.left) / b.width) * 100, y: ((e.clientY - b.top) / b.height) * 100 };
  };

  const begin = (e: RPointerEvent, d: Drag) => {
    e.stopPropagation();
    e.preventDefault();
    frame.current!.setPointerCapture(e.pointerId);
    setDrag(d);
  };

  const onMove = (e: RPointerEvent) => {
    if (!drag) return;
    const p = pct(e);
    if (drag.kind === "draw") {
      const x = Math.min(p.x, drag.startX);
      const y = Math.min(p.y, drag.startY);
      setDrag({ ...drag, rect: { x, y, w: Math.abs(p.x - drag.startX), h: Math.abs(p.y - drag.startY) } });
    } else {
      const dx = p.x - drag.startX;
      const dy = p.y - drag.startY;
      const r = drag.orig;
      const raw = clampRect(drag.kind === "move" ? { ...r, x: r.x + dx, y: r.y + dy } : { ...r, w: r.w + dx, h: r.h + dy });
      if (e.altKey) {
        // Hold Alt (Option on Mac) for free positioning.
        setGuides({ x: [], y: [] });
        onRectChange(drag.id, raw);
      } else {
        const others = screen.elements.filter((el) => el.id !== drag.id).map((el) => el.rect);
        const snapped = snapRect(raw, others, drag.kind);
        setGuides(snapped.guides);
        onRectChange(drag.id, snapped.rect);
      }
    }
  };

  const onUp = () => {
    if (drag?.kind === "draw" && drag.rect.w > 1 && drag.rect.h > 1) onCreate(clampRect(drag.rect));
    setDrag(null);
    setGuides({ x: [], y: [] });
  };

  return (
    <div className="edit-wrap" onPointerMove={onMove} onPointerUp={onUp}>
      <Frame
        screen={screen}
        frameRef={frame}
        className="editing"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const p = pct(e);
          onSelect(null);
          begin(e, { kind: "draw", startX: p.x, startY: p.y, rect: { x: p.x, y: p.y, w: 0, h: 0 } });
        }}
      >
        {screen.elements.map((el) => (
          <div
            key={el.id}
            className={`edit-el kind-${el.kind} ${el.id === selectedId ? "selected" : ""} ${el.visibleIf?.length ? "conditional" : ""}`}
            style={rectStyle(el.rect)}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              onSelect(el.id);
              const p = pct(e);
              begin(e, { kind: "move", id: el.id, startX: p.x, startY: p.y, orig: el.rect });
            }}
          >
            <span className="edit-label">
              <b>{el.kind}</b> {el.label}
            </span>
            {el.id === selectedId && (
              <span
                className="resize-handle"
                onPointerDown={(e) => {
                  const p = pct(e);
                  begin(e, { kind: "resize", id: el.id, startX: p.x, startY: p.y, orig: el.rect });
                }}
              />
            )}
          </div>
        ))}
        {drag?.kind === "draw" && <div className="draw-rect" style={rectStyle(drag.rect)} />}
        {guides.x.map((x) => <div key={`gx${x}`} className="guide guide-x" style={{ left: `${x}%` }} />)}
        {guides.y.map((y) => <div key={`gy${y}`} className="guide guide-y" style={{ top: `${y}%` }} />)}
      </Frame>
    </div>
  );
}
