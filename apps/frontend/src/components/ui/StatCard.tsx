import type { LucideIcon } from "lucide-react";

export function StatCard({
  label,
  value,
  icon: Icon,
  color,
  pulse,
  onClick,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  color: string;
  // Petit indicateur pulsant à côté de la valeur — réservé aux métriques "en
  // direct" dont l'état change sans action de l'utilisateur.
  pulse?: boolean;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag className="stat-card" style={{ borderTopColor: color }} onClick={onClick}>
      <div className="stat-card-top">
        <span className="stat-card-label">{label}</span>
        <span className="stat-card-icon" style={{ background: `${color}1f`, color }}>
          <Icon size={18} />
        </span>
      </div>
      <div className="stat-card-value">
        {value}
        {pulse && value > 0 && <span className="stat-card-pulse-dot" style={{ background: color }} />}
      </div>
    </Tag>
  );
}
