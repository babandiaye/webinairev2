import { BarChart3, PenSquare, Presentation as PresentationIcon, Users, Video } from "lucide-react";

export type CallPanel = "breakout" | "whiteboard" | "polls" | "presentations";

// Rail persistant remplaçant l'ancien menu "..." en popup — accès direct aux
// fonctionnalités de la salle, toujours visible plutôt que caché derrière un clic.
// Volontairement limité aux fonctionnalités propres à CETTE salle (pas de lien
// vers le tableau de bord/utilisateurs global : quitter l'appel depuis un clic de
// nav qui ressemble à une navigation normale serait trompeur).
export function CallSideNav({
  canManage,
  isInBreakout,
  activePanel,
  onSelect,
}: {
  canManage: boolean;
  isInBreakout: boolean;
  activePanel: CallPanel | null;
  onSelect: (panel: CallPanel) => void;
}) {
  function itemClass(panel: CallPanel) {
    return `call-side-nav-item ${activePanel === panel ? "active" : ""}`;
  }

  return (
    <nav className="call-side-nav">
      <button
        className={`call-side-nav-item ${activePanel === null ? "active" : ""}`}
        disabled
        title="Réunion en cours"
      >
        <Video size={19} />
        <span>Réunion</span>
      </button>

      {/* Ouvrir/dessiner sur le tableau blanc et gérer les présentations sont des
          actions réservées au modérateur côté API (RequireRoomAccess) — le bouton
          serait de toute façon inopérant pour un participant. Le contenu partagé
          (tableau, diapositive active) leur reste affiché automatiquement dès que
          le modérateur l'active, sans passer par ce rail (voir Whiteboard.tsx /
          PresentationsPanel.tsx). Les sondages restent accessibles à tous : c'est
          le seul moyen pour un participant de voter, et le panneau lui-même
          n'affiche déjà aucun contrôle de modération à qui n'a pas canManage. */}
      {canManage && (
        <button className={itemClass("whiteboard")} onClick={() => onSelect("whiteboard")} title="Tableau blanc">
          <PenSquare size={19} />
          <span>Tableau blanc</span>
        </button>
      )}

      <button className={itemClass("polls")} onClick={() => onSelect("polls")} title="Sondages">
        <BarChart3 size={19} />
        <span>Sondages</span>
      </button>

      {canManage && (
        <button
          className={itemClass("presentations")}
          onClick={() => onSelect("presentations")}
          title="Présentations"
        >
          <PresentationIcon size={19} />
          <span>Présentations</span>
        </button>
      )}

      {canManage && !isInBreakout && (
        <button className={itemClass("breakout")} onClick={() => onSelect("breakout")} title="Salles de sous-groupe">
          <Users size={19} />
          <span>Sous-groupes</span>
        </button>
      )}
    </nav>
  );
}
