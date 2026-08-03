import type { LucideIcon } from "lucide-react";

/**
 * Un segment du bandeau de statistiques du tableau de bord.
 *
 * Remplace les anciennes cartes individuelles : cinq cartes au même rayon, à la
 * même ombre et à la pastille d'icône colorée, c'était exactement la mise en
 * page que la charte du projet écarte. Surtout, leurs cinq teintes (bleu,
 * rouge, vert, ardoise, orange) formaient une palette pastel décorative qui
 * contredisait la règle « une dominante, un accent, et le vert/rouge réservés
 * au sémantique ».
 *
 * Ici, aucune couleur par défaut : le chiffre est à l'encre du texte, l'icône
 * est monochrome et discrète. `alert` est la SEULE exception — elle vire au
 * rouge quand la valeur est non nulle, parce qu'une séance en direct est un
 * état qui appelle une action. Une couleur qui apparaît veut alors dire
 * quelque chose.
 */
export function StatItem({
  label,
  value,
  icon: Icon,
  alert,
  onClick,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  /** Bascule en rouge + pastille pulsante dès que la valeur dépasse zéro. */
  alert?: boolean;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  const active = Boolean(alert) && value > 0;

  return (
    <Tag className={`stat-item${active ? " stat-item-alert" : ""}`} onClick={onClick}>
      <span className="stat-item-label">
        <Icon size={14} strokeWidth={2} aria-hidden />
        {label}
      </span>
      <span className="stat-item-value">
        {value}
        {active && <span className="stat-item-dot" />}
      </span>
    </Tag>
  );
}
