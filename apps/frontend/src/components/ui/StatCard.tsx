import type { LucideIcon } from "lucide-react";

export function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  color: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-card-top">
        <span className="stat-card-label">{label}</span>
        <span className="stat-card-icon" style={{ background: `${color}22`, color }}>
          <Icon size={18} />
        </span>
      </div>
      <div className="stat-card-value">{value}</div>
    </div>
  );
}
