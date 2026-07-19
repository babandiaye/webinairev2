// SVG minimaliste, sans dépendance npm : le projet n'a actuellement aucune
// librairie de graphiques et les bundles sont déjà volumineux (Excalidraw
// embarque mermaid/katex en transitif) — une simple polyline suffit largement
// pour une sparkline. currentColor permet de piloter la teinte depuis le CSS
// appelant (var(--color-success) etc.), donc ça se thème clair/sombre nativement.
export function Sparkline({
  values,
  width = 120,
  height = 32,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  if (values.length < 2) {
    return <svg width={width} height={height} className="status-sparkline" />;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  // Évite une division par zéro quand toutes les valeurs sont égales (courbe plate) —
  // dans ce cas on centre simplement le tracé verticalement.
  const range = max - min || 1;

  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="status-sparkline">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
