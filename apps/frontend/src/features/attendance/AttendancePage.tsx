import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Crown } from "lucide-react";
import { AttendanceDto } from "@webinairev2/shared-types";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { DashboardLayout } from "../../components/layout/DashboardLayout";

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h${m.toString().padStart(2, "0")}`;
  return `${m}m${s.toString().padStart(2, "0")}`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

export function AttendancePage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [attendance, setAttendance] = useState<AttendanceDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    function load() {
      api
        .listAttendance(id!)
        .then((data) => {
          if (!cancelled) setAttendance(data);
        })
        .catch((e) => {
          if (!cancelled) setError(e instanceof Error ? e.message : "Erreur inconnue");
        });
    }

    load();
    // Le temps de présence des connexions encore ouvertes progresse en direct —
    // même intervalle de rafraîchissement que les autres panneaux "live" du projet.
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [id]);

  if (!user) return null;

  const totalPresence = attendance.length;
  const currentlyConnected = attendance.filter((a) => a.lastLeftAt === null).length;

  return (
    <DashboardLayout user={user} search={search} onSearchChange={setSearch}>
      <button className="back-link" onClick={() => navigate("/")}>
        <ArrowLeft size={15} />
        Retour au tableau de bord
      </button>

      <div className="dashboard-welcome">
        <h2>Liste de présence</h2>
        <p>
          {totalPresence} participant{totalPresence > 1 ? "s" : ""} au total
          {currentlyConnected > 0 && ` · ${currentlyConnected} actuellement connecté${currentlyConnected > 1 ? "s" : ""}`}
        </p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="panel" style={{ marginTop: 20 }}>
        {attendance.length === 0 ? (
          <p className="empty-state">Personne ne s'est encore connecté à cette salle.</p>
        ) : (
          <div className="attendance-list">
            {attendance.map((a) => (
              <div className="attendance-item" key={a.identity}>
                <div className="attendance-row">
                  <div className="attendance-info">
                    <p className="attendance-name">
                      {a.isModerator && <Crown size={14} className="attendance-moderator-icon" />}
                      {a.name}
                      {a.lastLeftAt === null && (
                        <span className="attendance-live-dot" title="Actuellement connecté" />
                      )}
                    </p>
                    <span className="attendance-sub">
                      Arrivé à {formatDateTime(a.firstJoinedAt)}
                      {a.sessions.length > 1 && ` · ${a.sessions.length} connexions`}
                    </span>
                  </div>
                  <div className="attendance-duration">{formatDuration(a.totalDurationSeconds)}</div>
                  {a.sessions.length > 1 && (
                    <button
                      className="btn btn-ghost"
                      onClick={() => setExpanded(expanded === a.identity ? null : a.identity)}
                    >
                      {expanded === a.identity ? "Masquer" : "Détails"}
                    </button>
                  )}
                </div>
                {expanded === a.identity && (
                  <div className="attendance-sessions">
                    {a.sessions.map((s, i) => (
                      <div className="attendance-session-row" key={i}>
                        <span>{formatDateTime(s.joinedAt)}</span>
                        <span>→</span>
                        <span>{s.leftAt ? formatDateTime(s.leftAt) : "en cours"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
