import { useEffect, useState } from "react";
import { Check, Copy, Radio, X } from "lucide-react";
import { IngressProtocol, IngressStatus, RoomIngressDto } from "@webinairev2/shared-types";
import { api } from "../../api/client";

const PROTOCOLS: { value: IngressProtocol; label: string; hint: string }[] = [
  { value: "rtmp", label: "RTMPS", hint: "OBS Studio classique" },
  { value: "whip", label: "WHIP", hint: "WebRTC, faible latence" },
];

const STATUS_LABELS: Record<IngressStatus, string> = {
  inactive: "En attente du flux OBS",
  buffering: "Connexion en cours…",
  publishing: "Diffusion en cours",
  error: "Flux refusé",
  complete: "Diffusion terminée",
};

// Le point d'entrée reste valable après un arrêt côté OBS : "complete" n'est pas
// un échec, juste l'état d'un encodeur qui s'est déconnecté proprement.
const STATUS_TONE: Record<IngressStatus, string> = {
  inactive: "obs-status-idle",
  buffering: "obs-status-pending",
  publishing: "obs-status-live",
  error: "obs-status-error",
  complete: "obs-status-idle",
};

const REFRESH_MS = 5000;

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Presse-papiers refusé (contexte non sécurisé, permission navigateur) :
      // le champ reste sélectionnable à la main, on n'affiche pas d'erreur pour
      // une commodité — mais pas de coche mensongère non plus.
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="obs-field">
      <label>{label}</label>
      <div className="obs-copy-row">
        <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
        <button className="btn btn-ghost" onClick={copy} title={`Copier ${label}`}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
      </div>
    </div>
  );
}

/**
 * Diffusion depuis un encodeur externe (OBS Studio) vers la salle.
 *
 * Panneau réservé à l'animateur : les identifiants affichés ici sont un droit de
 * publication dans la salle (l'API les refuse d'ailleurs à quiconque n'est pas
 * gestionnaire — voir IngressController).
 */
export function ObsPanel({
  roomId,
  open,
  onClose,
}: {
  roomId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [ingress, setIngress] = useState<RoomIngressDto | null>(null);
  const [protocol, setProtocol] = useState<IngressProtocol>("rtmp");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    function refresh() {
      api
        .getRoomIngress(roomId)
        .then(({ ingress: current }) => {
          if (cancelled) return;
          setIngress(current);
          if (current) setProtocol(current.protocol);
        })
        .catch(() => {
          // Panneau consultatif : un échec de rafraîchissement ne doit pas
          // effacer les identifiants déjà affichés à l'écran.
        });
    }

    refresh();
    // Le statut ne change qu'à la connexion de l'encodeur, sans notification
    // côté LiveKit vers l'application — l'interrogation périodique est le seul
    // moyen de voir « Diffusion en cours » apparaître sans recharger.
    const interval = setInterval(refresh, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [open, roomId]);

  async function handleCreate(next: IngressProtocol) {
    setLoading(true);
    setError(null);
    try {
      setIngress(await api.createRoomIngress(roomId, { protocol: next }));
      setProtocol(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }

  async function handleStop() {
    if (!confirm("Arrêter la diffusion OBS ? Les identifiants actuels cesseront de fonctionner.")) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await api.deleteRoomIngress(roomId);
      setIngress(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  const isWhip = ingress?.protocol === "whip";

  return (
    <div className="breakout-panel">
      <div className="breakout-panel-header">
        <h4>Diffusion OBS</h4>
        <button className="icon-btn" onClick={onClose} aria-label="Fermer">
          <X size={16} />
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {!ingress ? (
        <div className="breakout-panel-section">
          <p className="obs-hint">
            Diffusez depuis OBS Studio vers cette salle. Choisissez le protocole, puis reportez les
            identifiants générés dans OBS.
          </p>
          <div className="obs-protocols">
            {PROTOCOLS.map((p) => (
              <button
                key={p.value}
                className={`obs-protocol ${protocol === p.value ? "active" : ""}`}
                onClick={() => setProtocol(p.value)}
              >
                <strong>{p.label}</strong>
                <small>{p.hint}</small>
              </button>
            ))}
          </div>
          <button className="btn btn-primary" disabled={loading} onClick={() => handleCreate(protocol)}>
            <Radio size={15} />
            {loading ? "Génération…" : "Générer les identifiants"}
          </button>
        </div>
      ) : (
        <div className="breakout-panel-section">
          <div className={`obs-status ${STATUS_TONE[ingress.status]}`}>
            <span className="obs-status-dot" />
            {STATUS_LABELS[ingress.status]}
          </div>
          {ingress.error && <div className="error-banner">{ingress.error}</div>}

          <CopyField label={isWhip ? "URL WHIP" : "Serveur RTMPS"} value={ingress.url} />
          <CopyField label={isWhip ? "Jeton Bearer" : "Clé de flux"} value={ingress.streamKey} />

          <p className="obs-hint">
            {isWhip
              ? "Dans OBS → Paramètres → Flux : service « WHIP », collez l'URL et le jeton Bearer, puis « Démarrer le streaming »."
              : "Dans OBS → Paramètres → Flux : service « Personnalisé… », collez le serveur et la clé de flux, puis « Démarrer le streaming »."}
          </p>

          <div className="obs-actions">
            {PROTOCOLS.filter((p) => p.value !== ingress.protocol).map((p) => (
              <button
                key={p.value}
                className="btn btn-ghost"
                disabled={loading}
                onClick={() => handleCreate(p.value)}
              >
                Passer en {p.label}
              </button>
            ))}
            <button className="btn btn-danger" disabled={loading} onClick={handleStop}>
              Arrêter la diffusion
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
