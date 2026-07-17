import { Camera, Check, Mic, RefreshCw, Volume2, X } from "lucide-react";
import { useMediaDeviceSelect } from "@livekit/components-react";

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

// Regroupe caméra/microphone/haut-parleur en un seul endroit — remplace les
// petits menus déroulants auparavant accolés individuellement aux boutons
// micro/caméra de CallControlBar (redondant une fois ce panneau en place).
export function CallSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

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

        <DeviceSection kind="videoinput" label="Caméra" icon={<Camera size={15} />} />
        <DeviceSection kind="audioinput" label="Microphone (entrée)" icon={<Mic size={15} />} />
        <DeviceSection kind="audiooutput" label="Haut-parleur (sortie)" icon={<Volume2 size={15} />} />

        <p className="call-settings-hint">Le changement de périphérique s'applique en temps réel sans couper le live.</p>
      </div>
    </div>
  );
}
