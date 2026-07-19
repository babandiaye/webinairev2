// SVG fait maison, sans dépendance npm — même raisonnement que pour l'ancien
// Sparkline.tsx (supprimé) : le projet n'a aucune librairie de graphiques, et
// un graphe en barres journalières est trivial à faire en SVG pur. currentColor
// permet de piloter la teinte depuis le CSS appelant, donc ça se thème
// nativement en clair/sombre.
export function BarChart({
  points,
  formatValue,
  width = 280,
  height = 72,
}: {
  points: { date: string; value: number }[];
  formatValue?: (value: number) => string;
  width?: number;
  height?: number;
}) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const gap = 2;
  const barWidth = points.length > 0 ? (width - gap * (points.length - 1)) / points.length : 0;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="bar-chart">
      {points.map((p, i) => {
        const barHeight = Math.max(1, (p.value / max) * height);
        const x = i * (barWidth + gap);
        const y = height - barHeight;
        return (
          <rect key={p.date} x={x} y={y} width={barWidth} height={barHeight} rx={1.5} fill="currentColor">
            <title>
              {p.date} — {formatValue ? formatValue(p.value) : p.value}
            </title>
          </rect>
        );
      })}
    </svg>
  );
}
