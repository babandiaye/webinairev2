import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Crown, UserPlus, UserMinus } from "lucide-react";
import { EnrollableUserDto, EnrollmentDto, RoomDto } from "@webinairev2/shared-types";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { DashboardLayout } from "../../components/layout/DashboardLayout";
import { initialsOf } from "../../lib/initials";
import { ROLE_LABELS } from "../../lib/roleLabels";

const SEARCH_DEBOUNCE_MS = 300;

export function EnrollmentsPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [room, setRoom] = useState<RoomDto | null>(null);
  const [enrollments, setEnrollments] = useState<EnrollmentDto[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EnrollableUserDto[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    Promise.all([api.getRoom(id), api.listEnrollments(id)])
      .then(([r, e]) => {
        if (cancelled) return;
        setRoom(r);
        setEnrollments(e);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erreur inconnue");
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (query.trim().length === 0) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timeout = setTimeout(() => {
      api
        .searchEnrollableUsers(query)
        .then((data) => {
          if (!cancelled) setResults(data);
        })
        .catch(() => {});
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query]);

  if (!user) return null;

  const enrolledIds = new Set(enrollments.map((e) => e.userId));

  async function handleEnroll(candidate: EnrollableUserDto) {
    setError(null);
    setPendingId(candidate.id);
    try {
      const enrollment = await api.enrollUser(id!, { userId: candidate.id });
      setEnrollments((prev) => [...prev, enrollment]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setPendingId(null);
    }
  }

  async function handleUnenroll(enrollment: EnrollmentDto) {
    if (!confirm(`Retirer ${enrollment.name} de ce cours ?`)) return;
    setError(null);
    setPendingId(enrollment.userId);
    try {
      await api.unenrollUser(id!, enrollment.userId);
      setEnrollments((prev) => prev.filter((e) => e.userId !== enrollment.userId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <DashboardLayout user={user} search={search} onSearchChange={setSearch}>
      <button className="back-link" onClick={() => navigate("/")}>
        <ArrowLeft size={15} />
        Retour au tableau de bord
      </button>

      <div className="dashboard-welcome">
        <h2>Étudiants inscrits{room ? ` — ${room.title}` : ""}</h2>
        <p>
          {enrollments.length} inscrit{enrollments.length > 1 ? "s" : ""}
        </p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="panel-header">
          <h3>Inscrire un utilisateur</h3>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher par nom ou email…"
          style={{ marginBottom: 12 }}
        />
        {results.length > 0 && (
          <div className="users-list">
            {results.map((candidate) => {
              const alreadyEnrolled = enrolledIds.has(candidate.id);
              const busy = pendingId === candidate.id;
              return (
                <div className="user-row" key={candidate.id}>
                  <div className="user-info">
                    <div className="avatar">{initialsOf(candidate.name)}</div>
                    <div>
                      <p className="user-name">{candidate.name}</p>
                      <span className="user-email">{candidate.email}</span>
                    </div>
                  </div>
                  <div className="user-controls">
                    <span className={`role-badge role-${candidate.role.toLowerCase()}`}>
                      {ROLE_LABELS[candidate.role]}
                    </span>
                    <button
                      className="btn btn-primary"
                      disabled={alreadyEnrolled || busy}
                      onClick={() => handleEnroll(candidate)}
                    >
                      <UserPlus size={15} />
                      {alreadyEnrolled ? "Déjà inscrit" : "Inscrire"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="panel-header">
          <h3>Inscrits ({enrollments.length})</h3>
        </div>
        {enrollments.length === 0 ? (
          <p className="empty-state">Personne n'est encore inscrit à ce cours.</p>
        ) : (
          <div className="users-list">
            {enrollments.map((enrollment) => {
              const busy = pendingId === enrollment.userId;
              const isCoModerator = enrollment.role === "MODERATOR";
              return (
                <div className="user-row" key={enrollment.userId}>
                  <div className="user-info">
                    <div className="avatar">{initialsOf(enrollment.name)}</div>
                    <div>
                      <p className="user-name">
                        {isCoModerator && <Crown size={14} className="attendance-moderator-icon" />}
                        {enrollment.name}
                      </p>
                      <span className="user-email">{enrollment.email}</span>
                    </div>
                  </div>
                  <div className="user-controls">
                    <span className={`role-badge role-${enrollment.role.toLowerCase()}`}>
                      {isCoModerator ? "Co-modérateur" : ROLE_LABELS[enrollment.role]}
                    </span>
                    <button className="btn btn-ghost" disabled={busy} onClick={() => handleUnenroll(enrollment)}>
                      <UserMinus size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
