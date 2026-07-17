import { useEffect, useState } from "react";
import { PhoneOff, Users, Video } from "lucide-react";
import { ConnectionQualityIndicator, useLocalParticipant, useParticipants, useRoomContext } from "@livekit/components-react";
import { api } from "../../api/client";
import { useRecordingStatus } from "./useRecordingStatus";

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function CallTopBar({
  roomId,
  title,
  canManage,
}: {
  roomId: string;
  title: string;
  canManage: boolean;
}) {
  // Indicateur seul (pas de bouton ici) : démarrer/arrêter l'enregistrement se
  // fait désormais depuis la barre du bas (CallControlBar) — tout le monde
  // voit quand même qu'un enregistrement est en cours, pour la transparence.
  const { activeRecording } = useRecordingStatus(roomId);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();
  const [error, setError] = useState<string | null>(null);

  // Chronomètre affiché pendant la capture effective (ACTIVE) — pas pendant
  // STARTING/ENDING, où startedAt existe déjà mais rien n'est encore filmé.
  useEffect(() => {
    if (activeRecording?.status !== "ACTIVE" || !activeRecording.startedAt) {
      setElapsedSeconds(0);
      return;
    }
    const startedAt = new Date(activeRecording.startedAt).getTime();
    function tick() {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [activeRecording?.status, activeRecording?.startedAt]);

  // Distinct de "Quitter" (CallControlBar, accessible à tout le monde y compris
  // au modérateur) : celui-ci termine la réunion pour TOUT LE MONDE, geste
  // irréversible pour les autres participants — confirmation explicite requise.
  async function handleEndForEveryone() {
    if (!confirm("Terminer la réunion pour tout le monde ?")) return;
    try {
      // Supprime la salle LiveKit côté serveur : force la déconnexion de TOUS les
      // participants (pas seulement soi), y compris le modérateur qui a cliqué.
      await api.closeRoom(roomId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
      return;
    }
    room.disconnect();
  }

  return (
    <div className="call-topbar">
      <div className="call-topbar-left">
        <span className="call-topbar-logo">
          <Video size={15} />
        </span>
        <span className="call-topbar-title">{title}</span>
      </div>

      <div className="call-topbar-center">
        {activeRecording && (
          <div className="recording-status">
            <span className="recording-dot" />
            {activeRecording.status === "ACTIVE"
              ? "Enregistrement en cours"
              : activeRecording.status === "STARTING"
                ? "Démarrage de l'enregistrement…"
                : "Finalisation de l'enregistrement…"}
            {activeRecording.status === "ACTIVE" && (
              <span className="recording-timer">{formatElapsed(elapsedSeconds)}</span>
            )}
          </div>
        )}
        {error && <span className="call-topbar-error">{error}</span>}
      </div>

      <div className="call-topbar-right">
        <ConnectionQualityIndicator className="call-connection-quality" participant={localParticipant} />
        <span className="call-participant-count">
          <Users size={14} />
          {participants.length}
        </span>
        {canManage && (
          <button className="call-end-btn" onClick={handleEndForEveryone}>
            <PhoneOff size={15} />
            Terminer
          </button>
        )}
      </div>
    </div>
  );
}
