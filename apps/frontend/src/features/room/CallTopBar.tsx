import { useEffect, useRef, useState } from "react";
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

// Si le démarrage (Chrome headless + chargement de /egress-view + signal
// START_RECORDING) dépasse cette durée, on le signale plutôt que de laisser le
// message "va bientôt commencer" tourner indéfiniment sans explication.
const STARTING_TOO_LONG_MS = 45_000;

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
  const [startingTooLong, setStartingTooLong] = useState(false);
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();
  const [error, setError] = useState<string | null>(null);

  // Ancre le chrono ACTIVE sur l'horloge du NAVIGATEUR au moment où CE client
  // détecte le passage à ACTIVE pour cet enregistrement précis — pas sur
  // startedAt (horloge du serveur). L'horloge du serveur peut être décalée
  // (dérive NTP en cours côté infra, voir docs/RUNBOOK.md) sans qu'on puisse
  // la corriger depuis le frontend ; comparer deux horloges différentes ferait
  // apparaître un chrono qui "démarre déjà en avance" du montant du décalage.
  // Ainsi le chrono affiche toujours 00:00 pile au moment où "Enregistrement
  // en cours" s'affiche pour ce client, quel que soit l'état des horloges.
  // Contrepartie assumée : un client qui recharge la page en pleine capture,
  // ou qui apprend l'état ACTIVE avec un peu de retard (polling/push), perd
  // ce repère et repart de 00:00 à cet instant plutôt que de rattraper le
  // temps déjà écoulé — préférable à un chrono qui saute en avant au hasard
  // du décalage d'horloge.
  const activeRecordingIdRef = useRef<string | null>(null);
  const clientActiveSinceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!activeRecording) {
      setElapsedSeconds(0);
      setStartingTooLong(false);
      activeRecordingIdRef.current = null;
      clientActiveSinceRef.current = null;
      return;
    }

    if (activeRecording.status === "STARTING") {
      const createdAt = new Date(activeRecording.createdAt).getTime();
      function tick() {
        setStartingTooLong(Date.now() - createdAt > STARTING_TOO_LONG_MS);
      }
      tick();
      const interval = setInterval(tick, 1000);
      return () => clearInterval(interval);
    }

    if (activeRecording.status === "ACTIVE") {
      if (activeRecordingIdRef.current !== activeRecording.id) {
        activeRecordingIdRef.current = activeRecording.id;
        clientActiveSinceRef.current = Date.now();
      }
      const clientActiveSince = clientActiveSinceRef.current!;
      function tick() {
        setElapsedSeconds(Math.max(0, Math.floor((Date.now() - clientActiveSince) / 1000)));
      }
      tick();
      const interval = setInterval(tick, 1000);
      return () => clearInterval(interval);
    }
  }, [activeRecording?.status, activeRecording?.createdAt, activeRecording?.id]);

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
          <div
            className={
              activeRecording.status === "STARTING"
                ? "recording-status recording-status-starting"
                : "recording-status"
            }
          >
            <span className="recording-dot" />
            {activeRecording.status === "STARTING" &&
              (startingTooLong
                ? "Le démarrage prend plus longtemps que prévu…"
                : "L'enregistrement va bientôt commencer…")}
            {activeRecording.status === "ACTIVE" && "Enregistrement en cours"}
            {activeRecording.status === "ENDING" && "Finalisation…"}
            {(activeRecording.status === "ACTIVE" || activeRecording.status === "ENDING") && (
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
