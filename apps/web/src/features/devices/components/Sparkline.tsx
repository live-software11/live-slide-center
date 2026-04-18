/**
 * Sprint T-2 (G9) — Sparkline SVG inline (zero dependencies).
 *
 * Disegna un trend mini (~120×24) di una metrica numerica 0..100 con:
 * - Linea SVG path D continuo da N punti.
 * - Banda warning/critical opzionale (sfondo giallo/rosso a soglia).
 * - Marker tonale ultimo punto (verde/giallo/rosso a seconda della soglia).
 * - Aria-label leggibile per screenreader.
 *
 * Performance: 1 SVG per metrica, ~200 byte di markup totali. 12 device × 3
 * sparkline = 36 SVG = trascurabile vs Recharts (350KB+).
 */

interface SparklineProps {
  /** Array di valori 0..100 (gia' filtrati, no null). Se vuoto, no-op. */
  values: number[];
  /** Larghezza in pixel. Default 120. */
  width?: number;
  /** Altezza in pixel. Default 24. */
  height?: number;
  /** Soglia warning (default 70). Sopra → linea gialla. */
  warningAt?: number;
  /** Soglia critical (default 90). Sopra → linea rossa. */
  criticalAt?: number;
  /** Se true, inverte la logica delle soglie (utile per "disk free %": pochi = male). */
  inverted?: boolean;
  /** Label accessibile per screenreader. */
  ariaLabel?: string;
  /** Classe CSS extra per il container span. */
  className?: string;
}

export function Sparkline({
  values,
  width = 120,
  height = 24,
  warningAt = 70,
  criticalAt = 90,
  inverted = false,
  ariaLabel,
  className = '',
}: SparklineProps) {
  if (!values || values.length === 0) {
    return (
      <span
        className={`inline-block rounded bg-sc-elevated/40 ${className}`}
        style={{ width, height }}
        aria-hidden="true"
      />
    );
  }

  // Padding minimo per non far toccare i punti ai bordi (line cap rounded
  // potrebbe ritagliare a y=0/y=h).
  const padX = 2;
  const padY = 2;
  const innerW = Math.max(1, width - padX * 2);
  const innerH = Math.max(1, height - padY * 2);

  // Asse Y fisso 0..100 (le metriche sono percentuali).
  const yFor = (v: number) => padY + innerH - (Math.max(0, Math.min(100, v)) / 100) * innerH;

  // Asse X: spalmiamo i punti uniformemente. Se 1 solo punto, lo mettiamo a metra.
  const xFor = (i: number) =>
    values.length === 1 ? padX + innerW / 2 : padX + (i / (values.length - 1)) * innerW;

  // Path D = M ... L ... L ...
  const d = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(2)} ${yFor(v).toFixed(2)}`)
    .join(' ');

  // Determinazione tone basata sull'ULTIMO valore (quello che conta lato UX).
  // Le soglie passate sono SEMPRE espresse nei valori originali della metrica:
  //   - non-inverted (heap, storage, cpu, ram): >= soglia → male.
  //   - inverted (fps, battery, disk_free): <= soglia → male.
  // Es: per FPS, `criticalAt=15` significa "se FPS scende a 15 o meno, critico".
  const last = values[values.length - 1];
  const isCritical = inverted ? last <= criticalAt : last >= criticalAt;
  const isWarning = !isCritical && (inverted ? last <= warningAt : last >= warningAt);

  const lineColor = isCritical ? '#ef4444' : isWarning ? '#f59e0b' : '#22c55e';
  const dotColor = lineColor;

  const min = Math.min(...values).toFixed(0);
  const max = Math.max(...values).toFixed(0);
  const computedAria =
    ariaLabel ??
    `min ${min}%, max ${max}%, current ${last.toFixed(0)}%, ${values.length} samples`;

  return (
    <span
      className={`inline-block ${className}`}
      style={{ width, height }}
      role="img"
      aria-label={computedAria}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {/* Linea principale */}
        <path
          d={d}
          fill="none"
          stroke={lineColor}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Punto finale, leggermente piu' grande per indicare "current" */}
        <circle
          cx={xFor(values.length - 1).toFixed(2)}
          cy={yFor(last).toFixed(2)}
          r="2"
          fill={dotColor}
        />
      </svg>
    </span>
  );
}
