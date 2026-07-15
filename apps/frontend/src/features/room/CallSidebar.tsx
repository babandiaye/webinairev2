import { useState } from "react";
import { Hand, Mic, MicOff, ScreenShare, UserX, X } from "lucide-react";
import { useDataChannel, useParticipants } from "@livekit/components-react";
import type { Role } from "@webinairev2/shared-types";
import { api } from "../../api/client";
import { CallChat } from "./CallChat";

export type SidebarTab = "participants" | "chat";
const HAND_RAISE_TOPIC = "hand-raise";

// Valeurs de l'enum TrackSource de @livekit/protocol (non ré-importé côté
// frontend pour éviter une dépendance directe à un sous-paquet non exposé par
// livekit-client) — utilisées pour lire canPublishSources sur un Participant.
const TRACK_SOURCE_MICROPHONE = 2;
const TRACK_SOURCE_SCREEN_SHARE = 3;

// isModerator (droits LiveKit réels) plutôt que le rôle applicatif brut : un
// créateur de salle jamais promu globalement (ex. enseignant via le plugin
// Moodle) a role="VIEWER" mais isModerator=true, et doit s'afficher comme
// modérateur ici — voir livekit-token.service.ts.
function parseMetadata(metadata: string | undefined): { role: Role; isModerator: boolean } | null {
  try {
    const parsed = metadata ? JSON.parse(metadata) : null;
    if (!parsed?.role) return null;
    return { role: parsed.role, isModerator: parsed.isModerator === true };
  } catch {
    return null;
  }
}

function roleLabel(meta: { role: Role; isModerator: boolean } | null): string | null {
  if (!meta) return null;
  if (meta.role === "ADMIN") return "Présentateur";
  return meta.isModerator ? "Modérateur" : "Participant";
}

export function CallSidebar({
  roomId,
  localIdentity,
  canManage,
  tab,
  onTabChange,
  mobileOpen,
  onCloseMobile,
}: {
  roomId: string;
  localIdentity: string;
  canManage: boolean;
  tab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const participants = useParticipants();
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  // Main levée : signal éphémère, pas de persistance nécessaire (comme un
  // indicateur "en train d'écrire") — diffusé par CallControlBar, affiché ici.
  const [raisedHands, setRaisedHands] = useState<Record<string, boolean>>({});

  useDataChannel(HAND_RAISE_TOPIC, (msg) => {
    try {
      const { identity, raised } = JSON.parse(new TextDecoder().decode(msg.payload));
      setRaisedHands((prev) => ({ ...prev, [identity]: raised }));
    } catch {
      // message malformé ignoré
    }
  });

  async function handleMute(identity: string) {
    setActionBusy(identity);
    try {
      await api.muteParticipant(roomId, identity);
    } catch {
      // Notification d'erreur non bloquante : l'état réel se reflète de toute
      // façon dans p.isMicrophoneEnabled au prochain rendu.
    } finally {
      setActionBusy(null);
    }
  }

  async function handleRemove(identity: string, name: string) {
    if (!confirm(`Retirer ${name} de la salle ?`)) return;
    setActionBusy(identity);
    try {
      await api.removeParticipant(roomId, identity);
    } catch {
      // idem
    } finally {
      setActionBusy(null);
    }
  }

  async function handleSpeaker(identity: string, grant: boolean) {
    setActionBusy(identity);
    try {
      await api.setSpeakerPermission(roomId, identity, grant);
      // La main levée n'a plus lieu d'être une fois la parole accordée.
      if (grant) setRaisedHands((prev) => ({ ...prev, [identity]: false }));
    } catch {
      // idem
    } finally {
      setActionBusy(null);
    }
  }

  async function handlePresenter(identity: string, grant: boolean) {
    setActionBusy(identity);
    try {
      await api.setPresenterPermission(roomId, identity, grant);
    } catch {
      // idem
    } finally {
      setActionBusy(null);
    }
  }

  return (
    <>
      {mobileOpen && <div className="call-overlay-backdrop" onClick={onCloseMobile} />}
      <div className={`call-sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="call-sidebar-tabs">
          <button
            className={`call-sidebar-tab ${tab === "participants" ? "active" : ""}`}
            onClick={() => onTabChange("participants")}
          >
            Participants ({participants.length})
          </button>
          <button
            className={`call-sidebar-tab ${tab === "chat" ? "active" : ""}`}
            onClick={() => onTabChange("chat")}
          >
            Discussion
          </button>
          <button className="call-sidebar-close" onClick={onCloseMobile} title="Fermer" aria-label="Fermer">
            <X size={16} />
          </button>
        </div>

      <div className="call-sidebar-content">
        {/* Les deux panneaux restent montés en permanence (affichage piloté en
            CSS) : démonter <CallChat> perdrait l'historique de useChat() à
            chaque changement d'onglet, cf. commentaire dans CallChat.tsx. */}
        <div className={`call-sidebar-pane ${tab === "chat" ? "" : "call-sidebar-pane-hidden"}`}>
          <CallChat />
        </div>
        <div className={`call-sidebar-pane ${tab === "participants" ? "" : "call-sidebar-pane-hidden"}`}>
          <div className="call-participant-list">
            {participants.map((p) => {
              const meta = parseMetadata(p.metadata);
              const label = roleLabel(meta);
              const isMod = meta?.isModerator ?? false;
              const sources = p.permissions?.canPublishSources ?? [];
              const canSpeak = sources.includes(TRACK_SOURCE_MICROPHONE);
              const canPresent = sources.includes(TRACK_SOURCE_SCREEN_SHARE);
              const handRaised = raisedHands[p.identity] ?? false;

              return (
                <div className="call-participant-row" key={p.identity}>
                  <div className="call-participant-info">
                    <span className="call-participant-name">
                      {p.name || p.identity}
                      {p.identity === localIdentity && " (Vous)"}
                    </span>
                    {label && <span className="call-participant-role">{label}</span>}
                  </div>
                  <div className="call-participant-status">
                    {handRaised && <Hand size={14} className="call-participant-hand" />}
                    {!p.isMicrophoneEnabled && <MicOff size={14} className="call-participant-muted" />}
                  </div>
                  {canManage && p.identity !== localIdentity && (
                    <div className="call-participant-actions">
                      {!isMod && (
                        <button
                          className={`call-participant-action ${canSpeak ? "call-participant-action-active" : ""} ${
                            handRaised && !canSpeak ? "call-participant-action-highlight" : ""
                          }`}
                          title={canSpeak ? "Retirer la parole" : "Autoriser la parole"}
                          disabled={actionBusy === p.identity}
                          onClick={() => handleSpeaker(p.identity, !canSpeak)}
                        >
                          <Mic size={14} />
                        </button>
                      )}
                      {!isMod && (
                        <button
                          className={`call-participant-action ${canPresent ? "call-participant-action-active" : ""}`}
                          title={canPresent ? "Retirer la présentation" : "Nommer présentateur"}
                          disabled={actionBusy === p.identity}
                          onClick={() => handlePresenter(p.identity, !canPresent)}
                        >
                          <ScreenShare size={14} />
                        </button>
                      )}
                      {p.isMicrophoneEnabled && (
                        <button
                          className="call-participant-action"
                          title="Couper le micro"
                          disabled={actionBusy === p.identity}
                          onClick={() => handleMute(p.identity)}
                        >
                          <MicOff size={14} />
                        </button>
                      )}
                      <button
                        className="call-participant-action call-participant-action-danger"
                        title="Retirer de la salle"
                        disabled={actionBusy === p.identity}
                        onClick={() => handleRemove(p.identity, p.name || p.identity)}
                      >
                        <UserX size={14} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      </div>
    </>
  );
}
