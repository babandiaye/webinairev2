import { useEffect, useState } from "react";
import { AlertTriangle, VolumeX, X } from "lucide-react";
import { useEchoDetection } from "./useEchoDetection";

/**
 * Suggestion affichée quand un écho acoustique est probable (voir
 * useEchoDetection). Volontairement non bloquante et refermable : la détection
 * est heuristique, et couper le son de quelqu'un automatiquement sur une
 * suspicion serait pire que le problème.
 *
 * Doit être monté DANS <LiveKitRoom> (le hook lit les participants de la salle).
 */
export function EchoWarningBanner({
  speakerMuted,
  onMuteSpeakers,
}: {
  speakerMuted: boolean;
  onMuteSpeakers: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  // Inutile de surveiller quoi que ce soit si les haut-parleurs sont déjà
  // coupés : plus aucun son ne sort de cet appareil, donc plus d'écho possible
  // de son fait.
  const echoLikely = useEchoDetection(!speakerMuted && !dismissed);

  // Une fois le problème réglé (haut-parleurs coupés), la bannière peut
  // réapparaître plus tard si l'utilisateur les rallume — on ne garde donc pas
  // "dismissed" indéfiniment, seulement tant que l'écho reste détecté.
  useEffect(() => {
    if (!echoLikely) setDismissed(false);
  }, [echoLikely]);

  if (!echoLikely || dismissed) return null;

  return (
    <div className="call-echo-warning">
      <AlertTriangle size={17} />
      <div className="call-echo-warning-text">
        <strong>Écho probable</strong>
        <span>
          Un autre appareil semble être dans la même pièce que vous. Utilisez un casque, ou coupez le son de
          cet appareil.
        </span>
      </div>
      <button className="call-echo-warning-action" onClick={onMuteSpeakers}>
        <VolumeX size={15} />
        Couper le son
      </button>
      <button className="call-echo-warning-close" onClick={() => setDismissed(true)} aria-label="Ignorer">
        <X size={15} />
      </button>
    </div>
  );
}
