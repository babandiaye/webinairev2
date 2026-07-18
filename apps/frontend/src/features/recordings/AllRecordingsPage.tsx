import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Download, Play, Trash2, X } from "lucide-react";
import { RecordingWithRoomDto } from "@webinairev2/shared-types";
import { api, API_URL } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { DashboardLayout } from "../../components/layout/DashboardLayout";
import { formatDuration, formatSize, STATUS_BADGE_CLASS, STATUS_LABELS } from "./recording-format";

// Vue globale (toutes salles confondues), réservée ADMIN — RecordingsPage reste
// la vue par salle (créateur ou admin), accessible depuis le tableau de bord.
export function AllRecordingsPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [recordings, setRecordings] = useState<RecordingWithRoomDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (user?.role !== "ADMIN") return;
    api.listAllRecordings().then(setRecordings).catch((e) => setError(e.message));
  }, [user]);

  if (!user) return null;
  if (user.role !== "ADMIN") return <Navigate to="/" replace />;

  async function handleDownload(recordingId: string) {
    try {
      const link = await api.getRecordingDownloadLink(recordingId);
      window.location.href = `${API_URL}${link.url}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    }
  }

  async function handlePlay(recordingId: string) {
    try {
      const link = await api.getRecordingDownloadLink(recordingId);
      setPlaybackUrl(`${API_URL}${link.url}&inline=1`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    }
  }

  async function handleDelete(rec: RecordingWithRoomDto) {
    if (!window.confirm(`Supprimer définitivement l'enregistrement de "${rec.roomTitle}" ?`)) return;
    setBusyId(rec.id);
    try {
      await api.deleteRecording(rec.roomId, rec.id);
      setRecordings((prev) => prev.filter((r) => r.id !== rec.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setBusyId(null);
    }
  }

  const filtered = recordings.filter(
    (r) =>
      r.roomTitle.toLowerCase().includes(search.toLowerCase()) ||
      r.filename.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <DashboardLayout user={user} search={search} onSearchChange={setSearch}>
      <div className="dashboard-welcome">
        <h2>Enregistrements</h2>
        <p>Tous les enregistrements, toutes salles confondues.</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="panel" style={{ marginTop: 20 }}>
        {filtered.length === 0 ? (
          <p className="empty-state">Aucun enregistrement ne correspond.</p>
        ) : (
          <div className="recordings-list">
            {filtered.map((rec) => (
              <div className="recording-row" key={rec.id}>
                <div className="recording-info">
                  <p className="recording-title">{rec.roomTitle}</p>
                  <span className="recording-sub">
                    {rec.filename || "Enregistrement en cours…"} · {formatDuration(rec.duration)} ·{" "}
                    {formatSize(rec.size)} · {new Date(rec.createdAt).toLocaleString("fr-FR")}
                  </span>
                </div>
                <span className={`status-badge status-${STATUS_BADGE_CLASS[rec.status]}`}>
                  {STATUS_LABELS[rec.status]}
                </span>
                {/* Lire/Télécharger seulement si READY (rien à lire pour un échec) —
                    mais Supprimer reste utile aussi pour un enregistrement FAILED,
                    sinon il n'y a aucun moyen de nettoyer la liste depuis l'UI. */}
                {(rec.status === "READY" || rec.status === "FAILED") && (
                  <div className="recording-actions">
                    {rec.status === "READY" && (
                      <>
                        <button className="btn btn-ghost" onClick={() => handlePlay(rec.id)}>
                          <Play size={15} />
                          Lire
                        </button>
                        <button className="btn btn-primary" onClick={() => handleDownload(rec.id)}>
                          <Download size={15} />
                          Télécharger
                        </button>
                      </>
                    )}
                    <button className="btn btn-danger" onClick={() => handleDelete(rec)} disabled={busyId === rec.id}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {playbackUrl && (
        <div className="video-modal-backdrop" onClick={() => setPlaybackUrl(null)}>
          <div className="video-modal" onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn video-modal-close" onClick={() => setPlaybackUrl(null)}>
              <X size={18} />
            </button>
            <video src={playbackUrl} controls autoPlay />
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
