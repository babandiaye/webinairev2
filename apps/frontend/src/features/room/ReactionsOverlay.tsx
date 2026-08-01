import { useRoomSignals } from "./useRoomSignals";

/**
 * Réactions qui montent le long du bord de la scène puis s'effacent.
 *
 * Superposition purement décorative : `pointer-events: none` en CSS, sinon elle
 * intercepterait les clics sur la vidéo et les contrôles qu'elle recouvre.
 */
export function ReactionsOverlay() {
  const { reactions } = useRoomSignals();
  if (reactions.length === 0) return null;

  return (
    <div className="reactions-overlay" aria-hidden>
      {reactions.map((reaction) => (
        <div key={reaction.id} className="reaction-float">
          <span className="reaction-emoji">{reaction.emoji}</span>
          <span className="reaction-name">{reaction.name}</span>
        </div>
      ))}
    </div>
  );
}
