import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Upload, X } from "lucide-react";
import { useDataChannel } from "@livekit/components-react";
import { PresentationDto } from "@webinairev2/shared-types";
import { api, API_URL } from "../../api/client";

const TOPIC = "presentation";
const STATUS_LABELS: Record<PresentationDto["status"], string> = {
  UPLOADED: "En attente",
  CONVERTING: "Conversion en cours…",
  READY: "Prête",
  FAILED: "Échec de la conversion",
};

export function PresentationsPanel({
  roomId,
  canManage,
  open,
  onClose,
}: {
  roomId: string;
  canManage: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const [presentations, setPresentations] = useState<PresentationDto[]>([]);
  const [active, setActive] = useState<PresentationDto | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { send } = useDataChannel(TOPIC, () => {
    refreshActive();
  });

  function refreshList() {
    api.listPresentations(roomId).then(setPresentations).catch(() => {});
  }

  function refreshActive() {
    api.getActivePresentation(roomId).then(setActive).catch(() => {});
  }

  useEffect(() => {
    refreshActive();
    // La diapo active doit rester synchronisée même panneau fermé (elle s'affiche
    // en superposition pour tout le monde, pas seulement pour qui a ouvert le panneau).
    const interval = setInterval(refreshActive, 5000);
    return () => clearInterval(interval);
  }, [roomId]);

  useEffect(() => {
    if (!open) return;
    refreshList();
    // Tant que le panneau est ouvert, on suit la progression UPLOADED →
    // CONVERTING → READY sans que l'utilisateur ait à rouvrir le panneau —
    // avant ce correctif, la conversion pouvait sembler bloquée alors qu'elle
    // avançait, faute de rafraîchissement automatique de la liste.
    const interval = setInterval(refreshList, 3000);
    return () => clearInterval(interval);
  }, [open, roomId]);

  function notifyOthers() {
    send(new TextEncoder().encode("updated"), { reliable: true });
  }

  async function handleUpload(file: File) {
    setUploading(true);
    setError(null);
    try {
      await api.uploadPresentation(roomId, file);
      refreshList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleActivate(presentationId: string) {
    try {
      await api.activatePresentation(roomId, presentationId);
      refreshActive();
      notifyOthers();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    }
  }

  async function handleNavigate(delta: number) {
    if (!active) return;
    const nextIndex = active.currentSlideIndex + delta;
    if (nextIndex < 0 || nextIndex >= active.slideCount) return;
    try {
      await api.setCurrentSlide(roomId, active.id, { slideIndex: nextIndex });
      refreshActive();
      notifyOthers();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    }
  }

  async function handleStop() {
    try {
      await api.deactivatePresentation(roomId);
      setActive(null);
      notifyOthers();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    }
  }

  const currentSlide = active?.slides.find((s) => s.index === active.currentSlideIndex);

  return (
    <>
      {active && currentSlide && (
        <div className="presentation-overlay">
          <img src={`${API_URL}${currentSlide.imageUrl}`} alt={`Diapositive ${active.currentSlideIndex + 1}`} />
          <div className="presentation-overlay-bar">
            <span>
              {active.filename} — {active.currentSlideIndex + 1}/{active.slideCount}
            </span>
            {canManage && (
              <div className="presentation-overlay-controls">
                <button className="icon-btn" onClick={() => handleNavigate(-1)} disabled={active.currentSlideIndex === 0}>
                  <ChevronLeft size={18} />
                </button>
                <button
                  className="icon-btn"
                  onClick={() => handleNavigate(1)}
                  disabled={active.currentSlideIndex >= active.slideCount - 1}
                >
                  <ChevronRight size={18} />
                </button>
                <button className="icon-btn" onClick={handleStop} title="Masquer">
                  <X size={18} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {open && (
        <div className="breakout-panel">
          <div className="breakout-panel-header">
            <h4>Présentations</h4>
            <button className="icon-btn" onClick={onClose}>
              <X size={16} />
            </button>
          </div>

          {error && <div className="error-banner">{error}</div>}

          {canManage && (
            <div className="breakout-panel-section">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                style={{ display: "none" }}
                onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
              />
              <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                <Upload size={15} />
                {uploading ? "Envoi…" : "Importer un PDF"}
              </button>
            </div>
          )}

          {presentations.length === 0 ? (
            <p className="empty-state">Aucune présentation pour l'instant.</p>
          ) : (
            <div className="poll-list">
              {presentations.map((p) => (
                <div className="breakout-room-row" key={p.id}>
                  <span>
                    {p.filename}
                    {p.status !== "READY" && <> — {STATUS_LABELS[p.status]}</>}
                  </span>
                  {canManage && p.status === "READY" && (
                    <button className="btn btn-ghost" onClick={() => handleActivate(p.id)}>
                      Afficher
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
