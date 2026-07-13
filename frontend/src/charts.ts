import type { DayCount } from './api.js';

const SVGNS = 'http://www.w3.org/2000/svg';

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** Pick a clean axis max and tick count so every gridline lands on a round number. */
function niceScale(dataMax: number): { max: number; ticks: number } {
  if (dataMax <= 4) return { max: Math.max(2, dataMax), ticks: Math.max(2, dataMax) };
  let best = { max: Infinity, ticks: 4 };
  for (let mag = 1; mag <= 1e9; mag *= 10) {
    for (const m of [1, 2, 2.5, 5]) {
      const step = m * mag;
      if (!Number.isInteger(step)) continue;
      for (const ticks of [5, 4, 3]) {
        const max = step * ticks;
        if (max >= dataMax && (max < best.max || (max === best.max && ticks > best.ticks))) {
          best = { max, ticks };
        }
      }
    }
    if (best.max !== Infinity && mag * 10 > dataMax) break;
  }
  return best;
}

function fmtDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * Single-series clicks-per-day line chart: 2px accent line, 10% area wash,
 * hairline gridlines, crosshair hover with tooltip and surface-ringed marker.
 */
export function renderClicksChart(container: HTMLElement, data: DayCount[]): void {
  container.innerHTML = '';
  const width = Math.max(280, container.clientWidth || 640);
  const height = 220;
  const pad = { top: 14, right: 12, bottom: 26, left: 40 };
  const iw = width - pad.left - pad.right;
  const ih = height - pad.top - pad.bottom;

  const accent = cssVar('--accent') || '#2a78d6';
  const gridColor = cssVar('--grid') || '#e1e0d9';
  const baseline = cssVar('--baseline') || '#c3c2b7';
  const mutedInk = cssVar('--muted') || '#898781';
  const surface = cssVar('--surface') || '#fcfcfb';

  const scale = niceScale(Math.max(1, ...data.map((d) => d.clicks)));
  const yMax = scale.max;
  const x = (i: number) => pad.left + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v: number) => pad.top + ih - (v / yMax) * ih;

  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img' });
  svg.setAttribute('aria-label', 'Clicks per day');

  // Hairline gridlines — every tick lands on a round number by construction
  const tickCount = scale.ticks;
  for (let t = 0; t <= tickCount; t++) {
    const v = (yMax / tickCount) * t;
    const gy = y(v);
    svg.appendChild(el('line', { x1: pad.left, x2: width - pad.right, y1: gy, y2: gy, stroke: t === 0 ? baseline : gridColor, 'stroke-width': 1 }));
    const label = el('text', { x: pad.left - 8, y: gy + 4, 'text-anchor': 'end', 'font-size': 11, fill: mutedInk });
    label.style.fontVariantNumeric = 'tabular-nums';
    label.textContent = v >= 1000 ? `${(v / 1000).toLocaleString()}k` : String(v);
    svg.appendChild(label);
  }

  // X labels: first, last, and a few in between without crowding
  const maxLabels = Math.max(2, Math.floor(iw / 70));
  const step = Math.max(1, Math.ceil(data.length / maxLabels));
  const labelIdx = new Set<number>([0, data.length - 1]);
  for (let i = step; i < data.length - 1; i += step) {
    if (data.length - 1 - i >= step / 2) labelIdx.add(i);
  }
  for (const i of labelIdx) {
    const anchor = i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle';
    const tx = el('text', { x: x(i), y: height - 8, 'text-anchor': anchor, 'font-size': 11, fill: mutedInk });
    tx.textContent = fmtDate(data[i].date);
    svg.appendChild(tx);
  }

  // Area wash (~10% opacity) + 2px line
  const pts = data.map((d, i) => `${x(i)},${y(d.clicks)}`);
  if (data.length > 1) {
    const area = el('path', {
      d: `M ${pts.join(' L ')} L ${x(data.length - 1)},${y(0)} L ${x(0)},${y(0)} Z`,
      fill: accent,
      opacity: 0.1,
    });
    svg.appendChild(area);
    svg.appendChild(el('path', { d: `M ${pts.join(' L ')}`, fill: 'none', stroke: accent, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  }

  // Hover layer: crosshair + marker (with surface ring) + tooltip
  const crosshair = el('line', { x1: 0, x2: 0, y1: pad.top, y2: pad.top + ih, stroke: baseline, 'stroke-width': 1, visibility: 'hidden' });
  const ring = el('circle', { r: 6, fill: surface, visibility: 'hidden' });
  const dot = el('circle', { r: 4, fill: accent, visibility: 'hidden' });
  svg.appendChild(crosshair);
  svg.appendChild(ring);
  svg.appendChild(dot);

  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  container.appendChild(tip);

  const hit = el('rect', { x: pad.left, y: pad.top, width: iw, height: ih, fill: 'transparent' });
  hit.addEventListener('mousemove', (ev: MouseEvent) => {
    const rect = svg.getBoundingClientRect();
    const mx = ((ev.clientX - rect.left) / rect.width) * width;
    const i = Math.round(((mx - pad.left) / iw) * (data.length - 1));
    const idx = Math.min(data.length - 1, Math.max(0, i));
    const px = x(idx);
    const py = y(data[idx].clicks);
    crosshair.setAttribute('x1', String(px));
    crosshair.setAttribute('x2', String(px));
    crosshair.setAttribute('visibility', 'visible');
    for (const c of [ring, dot]) {
      c.setAttribute('cx', String(px));
      c.setAttribute('cy', String(py));
      c.setAttribute('visibility', 'visible');
    }
    tip.innerHTML = `<span class="n">${data[idx].clicks.toLocaleString()} click${data[idx].clicks === 1 ? '' : 's'}</span> <span class="d">${fmtDate(data[idx].date)}</span>`;
    tip.style.display = 'block';
    tip.style.left = `${(px / width) * 100}%`;
    tip.style.top = `${(py / height) * rect.height}px`;
  });
  hit.addEventListener('mouseleave', () => {
    crosshair.setAttribute('visibility', 'hidden');
    ring.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
    tip.style.display = 'none';
  });
  svg.appendChild(hit);

  container.appendChild(svg);
}

/** Tiny 7-day sparkline for table rows, drawn in the de-emphasis (muted) ink. */
export function sparklineSvg(values: number[]): SVGSVGElement {
  const w = 76;
  const h = 22;
  const padY = 3;
  const max = Math.max(1, ...values);
  const x = (i: number) => (values.length === 1 ? w / 2 : (i / (values.length - 1)) * w);
  const y = (v: number) => h - padY - (v / max) * (h - padY * 2);
  const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, 'aria-hidden': 'true' });
  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(' L ');
  svg.appendChild(el('path', { d: `M ${pts}`, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  return svg;
}
