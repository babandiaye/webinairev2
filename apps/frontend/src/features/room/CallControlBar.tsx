import { useEffect, useRef, useState } from "react";
import { Track } from "livekit-client";
import {
  useDataChannel,
  useLocalParticipant,
  useLocalParticipantPermissions,
  useMediaDeviceSelect,
  useTrackToggle,
} from "@livekit/components-react";
import {
  Check,
  ChevronUp,
  Circle,
  Hand,
  MessageSquare,
  Mic,
  MicOff,
  MoreHorizontal,
  ScreenShare,
  Square,
  Users,
  Video,
  VideoOff,
} from "lucide-react";
import { api } from "../../api/client";
import { useRecordingStatus } from "./useRecordingStatus";

const HAND_RAISE_TOPIC = "hand-raise";

// Valeurs de l'enum TrackSource de @livekit/protocol — voir le même commentaire
// dans CallSidebar.tsx.
const TRACK_SOURCE_MICROPHONE = 2;
const TRACK_SOURCE_CAMERA = 1;
const TRACK_SOURCE_SCREEN_SHARE = 3;

type ControlButtonProps = {
  label: string;
  enabled: boolean;
  pending: boolean;
  onIcon: React.ReactNode;
  offIcon: React.ReactNode;
  buttonProps: React.ButtonHTMLAttributes<HTMLButtonElement>;
  // Certains contrôles (micro/caméra) doivent lire "rouge = coupé", d'autres
  // (partage d'écran) doivent lire "bleu = actif" — le sens de la couleur
  // s'inverse selon le contrôle, cf. rendu ci-dessous.
  variant: "mute" | "toggle";
  // Un participant sans autorisation de parole/présentation (voir CallSidebar —
  // le modérateur l'accorde par salle, pas par simple clic local) : le bouton
  // reste visible mais grisé avec une bulle d'explication, plutôt qu'un clic qui
  // échouerait silencieusement côté LiveKit.
  forceDisabled?: boolean;
  disabledTitle?: string;
};

function ControlButton({
  label,
  enabled,
  pending,
  onIcon,
  offIcon,
  buttonProps,
  variant,
  forceDisabled,
  disabledTitle,
}: ControlButtonProps) {
  const state = variant === "mute" ? (enabled ? "neutral" : "off") : enabled ? "on" : "neutral";

  return (
    <button
      {...buttonProps}
      className={`call-control-btn call-control-btn-${state}`}
      disabled={pending || forceDisabled}
      title={forceDisabled && disabledTitle ? disabledTitle : label}
    >
      <span className="call-control-icon">{enabled ? onIcon : offIcon}</span>
      <span className="call-control-label">{label}</span>
    </button>
  );
}

// Petit sélecteur de périphérique (micro/caméra) accolé au bouton principal —
// même principe que le menu déroulant de Google Meet : la flèche ouvre la
// liste des entrées disponibles, l'appareil actif est mis en évidence.
function DeviceMenuButton({ kind, label }: { kind: MediaDeviceKind; label: string }) {
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({
    kind,
    requestPermissions: true,
  });
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="call-device-menu-wrapper" ref={wrapperRef}>
      <button
        className="call-device-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        title={`Choisir ${label.toLowerCase()}`}
      >
        <ChevronUp size={14} />
      </button>
      {open && devices.length > 0 && (
        <div className="call-device-menu">
          <div className="call-device-menu-header">{label}</div>
          {devices.map((d) => (
            <button
              key={d.deviceId}
              className={`call-device-menu-item ${d.deviceId === activeDeviceId ? "active" : ""}`}
              onClick={() => {
                setActiveMediaDevice(d.deviceId);
                setOpen(false);
              }}
            >
              <span>{d.label || "Périphérique inconnu"}</span>
              {d.deviceId === activeDeviceId && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Bouton "plat" pour les contrôles qui n'ont pas de useTrackToggle derrière eux
// (lever la main, ouvrir discussion/participants, arrêter l'enregistrement) —
// même habillage visuel que ControlButton mais sans distinction on/off icône.
function SimpleControlButton({
  label,
  icon,
  active,
  danger,
  disabled,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const state = danger ? "danger" : active ? "on" : "neutral";
  return (
    <button
      className={`call-control-btn call-control-btn-${state}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
    >
      <span className="call-control-icon">{icon}</span>
      <span className="call-control-label">{label}</span>
    </button>
  );
}

export function CallControlBar({
  roomId,
  canManage,
  onOpenChat,
  onOpenParticipants,
  onOpenMore,
}: {
  roomId: string;
  canManage: boolean;
  onOpenChat: () => void;
  onOpenParticipants: () => void;
  // Sur mobile, CallSideNav (tableau blanc/sondages/présentations/sous-groupes)
  // devient une feuille d'actions repliée par défaut — ce bouton l'ouvre. Bouton
  // masqué en CSS sur desktop, où ce rail reste visible en permanence.
  onOpenMore: () => void;
}) {
  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const camera = useTrackToggle({ source: Track.Source.Camera });
  const screenShare = useTrackToggle({ source: Track.Source.ScreenShare });
  const { localParticipant } = useLocalParticipant();
  const [handRaised, setHandRaised] = useState(false);
  const { send: sendHandRaise } = useDataChannel(HAND_RAISE_TOPIC);

  // Un participant démarre sans droit de publication (voir livekit-token.service.ts) —
  // le modérateur l'accorde par salle (CallSidebar), jamais par un simple clic
  // local. updateParticipant côté serveur pousse le changement sans reconnexion,
  // mais localParticipant (useLocalParticipant) reste la MÊME instance mutée en
  // place : lire localParticipant.permissions ici ne redéclenche pas de rendu à
  // la réception de ParticipantPermissionsChanged (React bloque le setState car
  // la référence ne change pas), d'où un bouton resté grisé jusqu'au prochain
  // rendu déclenché par autre chose (ex. changement d'onglet). useLocalParticipantPermissions
  // est le hook dédié de la lib : il observe cet évènement et renvoie un nouvel
  // objet à chaque changement, donc un rendu immédiat.
  const permissions = useLocalParticipantPermissions();
  const canPublishSources = permissions?.canPublishSources ?? [];
  const canSpeak = canManage || canPublishSources.includes(TRACK_SOURCE_MICROPHONE);
  const canUseCamera = canManage || canPublishSources.includes(TRACK_SOURCE_CAMERA);
  const canPresent = canManage || canPublishSources.includes(TRACK_SOURCE_SCREEN_SHARE);

  const { activeRecording, refresh: refreshRecording, notifyOthers: notifyRecordingChanged } =
    useRecordingStatus(roomId);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const isRecording = activeRecording !== null;
  const recordingPending = activeRecording?.status === "STARTING" || activeRecording?.status === "ENDING";

  const [muteAllBusy, setMuteAllBusy] = useState(false);

  async function handleMuteAll() {
    if (!confirm("Couper le micro de tous les participants ?")) return;
    setMuteAllBusy(true);
    try {
      await api.muteAllParticipants(roomId);
    } catch {
      // pas de blocage UI : un échec partiel se voit directement aux icônes micro
    } finally {
      setMuteAllBusy(false);
    }
  }

  async function toggleRecording() {
    setRecordingBusy(true);
    setRecordingError(null);
    try {
      if (isRecording) await api.stopRecording(roomId);
      else await api.startRecording(roomId);
      refreshRecording();
      notifyRecordingChanged();
    } catch (e) {
      setRecordingError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setRecordingBusy(false);
    }
  }

  function toggleHandRaise() {
    const next = !handRaised;
    setHandRaised(next);
    sendHandRaise(
      new TextEncoder().encode(JSON.stringify({ identity: localParticipant.identity, raised: next })),
      { reliable: true }
    );
  }

  return (
    <div className="call-control-bar">
      <div className="call-control-group">
        <ControlButton
          label={mic.enabled ? "Couper le micro" : "Activer le micro"}
          enabled={mic.enabled}
          pending={mic.pending}
          onIcon={<Mic size={22} />}
          offIcon={<MicOff size={22} />}
          buttonProps={mic.buttonProps}
          variant="mute"
          forceDisabled={!canSpeak}
          disabledTitle="Le modérateur doit vous autoriser à parler"
        />
        {canSpeak && <DeviceMenuButton kind="audioinput" label="Microphone" />}
      </div>

      <div className="call-control-group">
        <ControlButton
          label={camera.enabled ? "Couper la caméra" : "Activer la caméra"}
          enabled={camera.enabled}
          pending={camera.pending}
          onIcon={<Video size={22} />}
          offIcon={<VideoOff size={22} />}
          buttonProps={camera.buttonProps}
          variant="mute"
          forceDisabled={!canUseCamera}
          disabledTitle="Le modérateur doit vous autoriser à activer votre caméra"
        />
        {canUseCamera && <DeviceMenuButton kind="videoinput" label="Caméra" />}
      </div>

      {/* Masqué (pas seulement désactivé) pour un participant sans droit de
          présentation : contrairement au micro/caméra, ce n'est pas une action
          qu'on s'attend à voir par défaut sur une salle de webinaire (BBB a le
          même comportement — le partage d'écran est réservé au présentateur). */}
      {canPresent && (
        <ControlButton
          label={screenShare.enabled ? "Arrêter le partage" : "Partager l'écran"}
          enabled={screenShare.enabled}
          pending={screenShare.pending}
          onIcon={<ScreenShare size={22} />}
          offIcon={<ScreenShare size={22} />}
          buttonProps={screenShare.buttonProps}
          variant="toggle"
        />
      )}

      {canManage && (
        <SimpleControlButton
          label="Couper tous les micros"
          icon={<MicOff size={22} />}
          disabled={muteAllBusy}
          onClick={handleMuteAll}
        />
      )}

      {canManage && (
        <div className="call-control-group">
          <SimpleControlButton
            label={
              activeRecording?.status === "STARTING"
                ? "Démarrage…"
                : activeRecording?.status === "ENDING"
                  ? "Finalisation…"
                  : isRecording
                    ? "Arrêter l'enreg."
                    : "Enregistrer"
            }
            icon={isRecording ? <Square size={20} fill="currentColor" /> : <Circle size={22} />}
            danger={isRecording}
            disabled={recordingBusy || recordingPending}
            onClick={toggleRecording}
          />
          {recordingError && <div className="call-control-error">{recordingError}</div>}
        </div>
      )}

      <SimpleControlButton
        label={handRaised ? "Baisser la main" : "Lever la main"}
        icon={<Hand size={22} />}
        active={handRaised}
        onClick={toggleHandRaise}
      />

      <SimpleControlButton label="Discussion" icon={<MessageSquare size={22} />} onClick={onOpenChat} />

      <SimpleControlButton label="Participants" icon={<Users size={22} />} onClick={onOpenParticipants} />

      <button className="call-control-btn call-control-btn-more" onClick={onOpenMore} title="Plus d'options">
        <span className="call-control-icon">
          <MoreHorizontal size={22} />
        </span>
        <span className="call-control-label">Plus</span>
      </button>
    </div>
  );
}
