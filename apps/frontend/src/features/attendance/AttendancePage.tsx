import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ChevronLeft, ChevronRight, Crown, Trash2 } from "lucide-react";
import { AttendanceSessionGroupDto } from "@webinairev2/shared-types";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { DashboardLayout } from "../../components/layout/DashboardLayout";

const PAGE_SIZES = [20, 50, 100];

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
  const [sessions, setSessions] = useState<AttendanceSessionGroupDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Une seule session dépliée à la fois — avec potentiellement des centaines de
  // participants par session, tout afficher en même temps ne tiendrait pas.
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  // Clé composée "sessionId:identity" pour le détail des reconnexions d'un participant.
  const [expandedParticipant, setExpandedParticipant] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    function load() {
      api
        .listAttendance(id!)
        .then((data) => {
          if (!cancelled) setSessions(data);
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

  function toggleSession(sessionId: string) {
    setOpenSessionId((prev) => (prev === sessionId ? null : sessionId));
    setPage(1);
    setExpandedParticipant(null);
  }

  async function handleDeleteSession(session: AttendanceSessionGroupDto) {
    if (!confirm(`Supprimer la liste de présence "${session.sessionId}" ?`)) return;
    setError(null);
    try {
      await api.deleteAttendanceSession(id!, new Date(session.startedAt).getTime());
      setSessions((prev) => prev.filter((s) => s.sessionId !== session.sessionId));
      if (openSessionId === session.sessionId) setOpenSessionId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    }
  }

  const openSession = sessions.find((s) => s.sessionId === openSessionId) ?? null;
  const totalPages = openSession ? Math.max(1, Math.ceil(openSession.participants.length / pageSize)) : 1;
  const pagedParticipants = openSession
    ? openSession.participants.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize)
    : [];

  return (
    <DashboardLayout user={user} search={search} onSearchChange={setSearch}>
      <button className="back-link" onClick={() => navigate("/")}>
        <ArrowLeft size={15} />
        Retour au tableau de bord
      </button>

      <div className="dashboard-welcome">
        <h2>Liste de présence</h2>
        <p>
          {sessions.length} session{sessions.length > 1 ? "s" : ""} enregistrée{sessions.length > 1 ? "s" : ""}
        </p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="panel" style={{ marginTop: 20 }}>
        {sessions.length === 0 ? (
          <p className="empty-state">Personne ne s'est encore connecté à cette salle.</p>
        ) : (
          sessions.map((session) => {
            const currentlyConnected = session.participants.filter((p) => p.lastLeftAt === null).length;
            const isOpen = openSessionId === session.sessionId;
            return (
              <div className="attendance-item" key={session.sessionId}>
                <div className="attendance-row">
                  <div className="attendance-info">
                    <p className="attendance-name">
                      {session.sessionId}
                      {session.endedAt === null && (
                        <span className="attendance-live-dot" title="Session en cours" />
                      )}
                    </p>
                    <span className="attendance-sub">
                      {formatDateTime(session.startedAt)}
                      {session.endedAt ? ` → ${formatDateTime(session.endedAt)}` : " → en cours"}
                      {" · "}
                      {session.participants.length} participant{session.participants.length > 1 ? "s" : ""}
                      {currentlyConnected > 0 &&
                        ` · ${currentlyConnected} actuellement connecté${currentlyConnected > 1 ? "s" : ""}`}
                    </span>
                  </div>
                  <button className="btn btn-ghost" onClick={() => toggleSession(session.sessionId)}>
                    {isOpen ? "Masquer" : "Détails"}
                  </button>
                  <button
                    className="btn btn-danger"
                    title="Supprimer cette liste de présence"
                    onClick={() => handleDeleteSession(session)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>

                {isOpen && (
                  <div className="attendance-session-detail">
                    <div className="attendance-list">
                      {pagedParticipants.map((p) => {
                        const key = `${session.sessionId}:${p.identity}`;
                        return (
                          <div className="attendance-item" key={key}>
                            <div className="attendance-row">
                              <div className="attendance-info">
                                <p className="attendance-name">
                                  {p.isModerator && <Crown size={14} className="attendance-moderator-icon" />}
                                  {p.name}
                                  {p.lastLeftAt === null && (
                                    <span className="attendance-live-dot" title="Actuellement connecté" />
                                  )}
                                </p>
                                <span className="attendance-sub">
                                  Arrivé à {formatDateTime(p.firstJoinedAt)}
                                  {p.sessions.length > 1 && ` · ${p.sessions.length} connexions`}
                                </span>
                              </div>
                              <div className="attendance-duration">{formatDuration(p.totalDurationSeconds)}</div>
                              {p.sessions.length > 1 && (
                                <button
                                  className="btn btn-ghost"
                                  onClick={() => setExpandedParticipant(expandedParticipant === key ? null : key)}
                                >
                                  {expandedParticipant === key ? "Masquer" : "Connexions"}
                                </button>
                              )}
                            </div>
                            {expandedParticipant === key && (
                              <div className="attendance-sessions">
                                {p.sessions.map((s, i) => (
                                  <div className="attendance-session-row" key={i}>
                                    <span>{formatDateTime(s.joinedAt)}</span>
                                    <span>→</span>
                                    <span>{s.leftAt ? formatDateTime(s.leftAt) : "en cours"}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="attendance-pagination">
                      <span className="attendance-pagination-info">
                        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, session.participants.length)} sur{" "}
                        {session.participants.length}
                      </span>
                      <div className="attendance-pagination-controls">
                        <select
                          className="role-select"
                          value={pageSize}
                          onChange={(e) => {
                            setPageSize(Number(e.target.value));
                            setPage(1);
                          }}
                        >
                          {PAGE_SIZES.map((size) => (
                            <option key={size} value={size}>
                              {size} / page
                            </option>
                          ))}
                        </select>
                        <button
                          className="btn btn-ghost"
                          disabled={page <= 1}
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                        >
                          <ChevronLeft size={15} />
                        </button>
                        <span className="attendance-pagination-info">
                          {page} / {totalPages}
                        </span>
                        <button
                          className="btn btn-ghost"
                          disabled={page >= totalPages}
                          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        >
                          <ChevronRight size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </DashboardLayout>
  );
}
