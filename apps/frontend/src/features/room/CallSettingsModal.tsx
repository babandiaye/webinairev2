import { useState } from "react";
import { Camera, Check, Mic, MicOff, RefreshCw, VideoOff, Volume2, X } from "lucide-react";
import { useMediaDeviceSelect } from "@livekit/components-react";
import { RoomDto, UpdateRoomSettingsDto } from "@webinairev2/shared-types";
import { api } from "../../api/client";

function DeviceSection({
  kind,
  label,
  icon,
}: {
  kind: MediaDeviceKind;
  label: string;
  icon: React.ReactNode;
}) {
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({
    kind,
    requestPermissions: true,
  });

  if (devices.length === 0) return null;

  return (
    <div className="call-settings-section">
      <div className="call-settings-section-title">
        {icon}
        {label}
      </div>
      <div className="call-settings-device-list">
        {devices.map((d) => (
          <button
            key={d.deviceId}
            className={`call-settings-device ${d.deviceId === activeDeviceId ? "active" : ""}`}
            onClick={() => setActiveMediaDevice(d.deviceId)}
          >
            <span>{d.label || "Périphérique inconnu"}</span>
            {d.deviceId === activeDeviceId && <Check size={16} />}
          </button>
        ))}
      </div>
    </div>
  );
}

// Ligne interrupteur "Verrouiller X" — réutilise le style .theme-switch déjà
// défini pour le mode sombre (Sidebar.tsx), pas de nouveau composant toggle.
function LockToggle({
  label,
  locked,
  busy,
  onChange,
}: {
  label: string;
  locked: boolean;
  busy: boolean;
  onChange: (locked: boolean) => void;
}) {
  return (
    <div className="call-settings-lock-row">
      <span>{label}</span>
      <button
        className={`theme-switch ${locked ? "on" : ""}`}
        onClick={() => onChange(!locked)}
        disabled={busy}
        aria-label={label}
      />
    </div>
  );
}

// Regroupe caméra/microphone/haut-parleur en un seul endroit — remplace les
// petits menus déroulants auparavant accolés individuellement aux boutons
// micro/caméra de CallControlBar (redondant une fois ce panneau en place).
// La section "Session" (verrouillage micro/caméra pour les participants)
// n'est affichée que pour l'animateur (canManage) — un participant n'a pas
// son mot à dire sur cette politique, seulement sur ses propres périphériques.
export function CallSettingsModal({
  open,
  onClose,
  roomId,
  canManage,
  room,
  onRoomUpdate,
}: {
  open: boolean;
  onClose: () => void;
  roomId: string;
  canManage: boolean;
  room: RoomDto;
  onRoomUpdate: (room: RoomDto) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function updateSettings(dto: UpdateRoomSettingsDto) {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateRoomSettings(roomId, dto);
      onRoomUpdate(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  // Action ponctuelle ("couper maintenant") — distincte des interrupteurs
  // ci-dessus : ne change pas le verrouillage persistant, coupe juste ce qui
  // est actif à cet instant (un participant déverrouillé peut se rallumer).
  async function cutAll(action: () => Promise<{ ok: true }>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="call-settings-backdrop" onClick={onClose}>
      <div className="call-settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="call-settings-header">
          <div>
            <h3>Paramètres audio &amp; vidéo</h3>
            <p>Choisissez vos entrées et sortie</p>
          </div>
          <div className="call-settings-header-actions">
            <button
              className="icon-btn"
              onClick={() => window.location.reload()}
              title="Rafraîchir la liste des périphériques"
            >
              <RefreshCw size={16} />
            </button>
            <button className="icon-btn" onClick={onClose} title="Fermer">
              <X size={16} />
            </button>
          </div>
        </div>

        {canManage && (
          <div className="call-settings-section">
            <div className="call-settings-section-title">Session</div>
            <LockToggle
              label="Verrouiller les micros"
              locked={room.micLocked}
              busy={busy}
              onChange={(micLocked) => updateSettings({ micLocked })}
            />
            <LockToggle
              label="Verrouiller les caméras"
              locked={room.cameraLocked}
              busy={busy}
              onChange={(cameraLocked) => updateSettings({ cameraLocked })}
            />
            {/* Verrous d'interaction : contrairement aux deux du dessus, ils ne
                se traduisent par aucune permission LiveKit et sont appliqués par
                les clients (émission masquée ET réception filtrée) — voir
                RoomLocksMetadata. Défaut : ouvert, ce sont des mesures
                ponctuelles, pas le régime normal d'un cours. */}
            <LockToggle
              label="Verrouiller la discussion"
              locked={room.chatLocked}
              busy={busy}
              onChange={(chatLocked) => updateSettings({ chatLocked })}
            />
            <LockToggle
              label="Verrouiller les réactions"
              locked={room.reactionsLocked}
              busy={busy}
              onChange={(reactionsLocked) => updateSettings({ reactionsLocked })}
            />
            <LockToggle
              label="Masquer la liste des participants"
              locked={room.participantListLocked}
              busy={busy}
              onChange={(participantListLocked) => updateSettings({ participantListLocked })}
            />
            <div className="call-settings-actions">
              <button
                className="call-settings-action-btn"
                disabled={busy}
                onClick={() => cutAll(() => api.muteAllParticipants(roomId))}
              >
                <MicOff size={15} />
                Couper tous les micros maintenant
              </button>
              <button
                className="call-settings-action-btn"
                disabled={busy}
                onClick={() => cutAll(() => api.muteAllCameras(roomId))}
              >
                <VideoOff size={15} />
                Couper toutes les caméras maintenant
              </button>
            </div>
            {error && <p className="call-settings-error">{error}</p>}
          </div>
        )}

        <DeviceSection kind="videoinput" label="Caméra" icon={<Camera size={15} />} />
        <DeviceSection kind="audioinput" label="Microphone (entrée)" icon={<Mic size={15} />} />
        <DeviceSection kind="audiooutput" label="Haut-parleur (sortie)" icon={<Volume2 size={15} />} />

        <p className="call-settings-hint">Le changement de périphérique s'applique en temps réel sans couper le live.</p>
      </div>
    </div>
  );
}
