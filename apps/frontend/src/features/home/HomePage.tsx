import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarPlus,
  Radio,
  CheckCircle2,
  DoorOpen,
  Users,
  Video,
  ClipboardList,
  Trash2,
  UserCog,
  GraduationCap,
} from "lucide-react";
import { ActivityStatsDto, RoomDto, StatsRange } from "@webinairev2/shared-types";
import { useAuth } from "../../auth/AuthProvider";
import { api } from "../../api/client";
import { BRAND } from "../../lib/brand";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { StatCard } from "../../components/ui/StatCard";
import { DashboardLayout } from "../../components/layout/DashboardLayout";
import { BarChart } from "../../components/charts/BarChart";

const MONTHS = ["JAN", "FÉV", "MAR", "AVR", "MAI", "JUIN", "JUIL", "AOÛT", "SEP", "OCT", "NOV", "DÉC"];

function sum(points: { value: number }[]): number {
  return points.reduce((acc, p) => acc + p.value, 0);
}

function formatHours(totalSeconds: number): string {
  const hours = totalSeconds / 3600;
  return `${hours.toFixed(hours < 10 ? 1 : 0)} h`;
}

export function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<RoomDto[]>([]);
  // Comptes plateforme, réservés à l'admin (endpoints /users et /recordings
  // globaux gardés ADMIN côté backend — inutile de les appeler sinon).
  const [userCount, setUserCount] = useState<number | null>(null);
  const [recordingCount, setRecordingCount] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [statsRange, setStatsRange] = useState<StatsRange>("week");
  const [activityStats, setActivityStats] = useState<ActivityStatsDto | null>(null);

  const isAdmin = user?.role === "ADMIN";

  useEffect(() => {
    let cancelled = false;

    function load() {
      api
        .listRooms()
        .then((data) => {
          if (!cancelled) setRooms(data);
        })
        .catch((e) => {
          if (!cancelled) setError(e instanceof Error ? e.message : "Erreur inconnue");
        });

      if (isAdmin) {
        api
          .listUsers()
          .then((data) => {
            if (!cancelled) setUserCount(data.length);
          })
          .catch(() => {});
        api
          .listAllRecordings()
          .then((data) => {
            if (!cancelled) setRecordingCount(data.length);
          })
          .catch(() => {});
      }
    }

    load();
    // Sans ce polling, le statut d'une salle (ex. passage LIVE → ENDED côté
    // webhook LiveKit) resterait figé sur le tableau de bord tant que la page
    // n'est pas rechargée manuellement.
    const interval = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isAdmin]);

  useEffect(() => {
    let cancelled = false;
    api
      .getActivityStats(statsRange)
      .then((data) => {
        if (!cancelled) setActivityStats(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [statsRange]);

  async function handleDeleteRoom(room: RoomDto) {
    if (!confirm(`Supprimer définitivement la salle "${room.title}" ? Les enregistrements associés seront aussi supprimés.`))
      return;
    setError(null);
    try {
      await api.deleteRoom(room.id);
      setRooms((prev) => prev.filter((r) => r.id !== room.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    }
  }

  const filteredRooms = useMemo(
    () => rooms.filter((r) => r.title.toLowerCase().includes(search.toLowerCase())),
    [rooms, search]
  );

  const stats = useMemo(
    () => ({
      total: rooms.length,
      live: rooms.filter((r) => r.status === "LIVE").length,
      ended: rooms.filter((r) => r.status === "ENDED").length,
    }),
    [rooms]
  );

  if (!user) return null;
  const canCreateRoom = user.role === "ADMIN" || user.role === "MODERATOR";

  return (
    <DashboardLayout user={user} search={search} onSearchChange={setSearch}>
      {/* Titre de section et repère de date, pas d'accroche : "Bienvenue" et
          l'emoji en guise d'icône n'apportaient aucune information à quelqu'un
          qui ouvre son tableau de bord pour la troisième fois de la journée. */}
      <div className="dashboard-welcome">
        <h2>Cours magistraux</h2>
        <p>
          {new Date().toLocaleDateString("fr-FR", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
          {stats.live > 0 && ` · ${stats.live} séance${stats.live > 1 ? "s" : ""} en direct`}
        </p>
      </div>

      <div className="stat-grid">
        <StatCard label="Salles (CM) totales" value={stats.total} icon={DoorOpen} color={BRAND.blue} />
        <StatCard label="En direct" value={stats.live} icon={Radio} color={BRAND.red} pulse />
        <StatCard label="Terminées" value={stats.ended} icon={CheckCircle2} color={BRAND.green} />
        {isAdmin && userCount !== null && (
          <StatCard
            label="Utilisateurs"
            value={userCount}
            icon={Users}
            color={BRAND.slate}
            onClick={() => navigate("/admin/users")}
          />
        )}
        {isAdmin && recordingCount !== null && (
          <StatCard
            label="Enregistrements"
            value={recordingCount}
            icon={Video}
            color={BRAND.orange}
            onClick={() => navigate("/recordings")}
          />
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="dashboard-grid">
        <div className="panel">
          <div className="panel-header">
            <h3>Cours récents</h3>
          </div>

          {filteredRooms.length === 0 ? (
            <p className="empty-state">Aucune salle ne correspond.</p>
          ) : (
            <div className="meeting-list">
              {filteredRooms.map((room) => {
                const date = new Date(room.startedAt ?? room.endedAt ?? Date.now());
                return (
                  <div className="meeting-row" key={room.id}>
                    <div className="meeting-date">
                      <div className="meeting-date-day">{date.getDate()}</div>
                      <div className="meeting-date-month">{MONTHS[date.getMonth()]}</div>
                    </div>
                    <div className="meeting-info">
                      <p className="meeting-title">
                        {room.title}
                        {room.isMoodle && (
                          <span className="badge-moodle" title="Créé depuis Moodle">
                            <GraduationCap size={12} />
                            Moodle
                          </span>
                        )}
                      </p>
                      <span className="meeting-sub">Salle : {room.roomName}</span>
                    </div>
                    <div className="meeting-actions">
                      <StatusBadge status={room.status} />
                      <button className="btn btn-ghost" onClick={() => navigate(`/rooms/${room.id}/recordings`)}>
                        <Video size={15} />
                        Enregistrements
                      </button>
                      {room.canManage && (
                        <button className="btn btn-ghost" onClick={() => navigate(`/rooms/${room.id}/attendance`)}>
                          <ClipboardList size={15} />
                          Présence
                        </button>
                      )}
                      {room.canManage && (
                        <button className="btn btn-ghost" onClick={() => navigate(`/rooms/${room.id}/enrollments`)}>
                          <Users size={15} />
                          Étudiants
                        </button>
                      )}
                      {(room.status !== "ENDED" || canCreateRoom) && (
                        <button className="btn btn-primary" onClick={() => navigate(`/rooms/${room.id}`)}>
                          {room.status === "ENDED" ? "Redémarrer" : "Rejoindre"}
                        </button>
                      )}
                      {room.canManage && room.status !== "LIVE" && (
                        <button
                          className="btn btn-ghost"
                          title="Supprimer définitivement"
                          onClick={() => handleDeleteRoom(room)}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {(canCreateRoom || isAdmin) && (
          <div className="panel">
            <div className="panel-header">
              <h3>Actions rapides</h3>
            </div>

            <div className="quick-actions">
              {canCreateRoom && (
                <button className="quick-action-btn" onClick={() => navigate("/schedule")}>
                  <CalendarPlus size={16} />
                  Planifier un cours magistral
                </button>
              )}
              {isAdmin && (
                <button className="quick-action-btn" onClick={() => navigate("/admin/users")}>
                  <UserCog size={16} />
                  Gérer les utilisateurs
                </button>
              )}
              {isAdmin && (
                <button className="quick-action-btn" onClick={() => navigate("/recordings")}>
                  <Video size={16} />
                  Tous les enregistrements
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="panel-header">
          <h3>Activité</h3>
          <div className="range-toggle">
            <button
              className={statsRange === "week" ? "active" : ""}
              onClick={() => setStatsRange("week")}
            >
              Semaine
            </button>
            <button
              className={statsRange === "month" ? "active" : ""}
              onClick={() => setStatsRange("month")}
            >
              Mois
            </button>
          </div>
        </div>

        {activityStats && (
          <div className="activity-grid">
            <div className="activity-chart">
              <span className="activity-chart-value">{sum(activityStats.rooms)}</span>
              <span className="activity-chart-label">Cours (CM) créés</span>
              <BarChart points={activityStats.rooms} />
            </div>
            <div className="activity-chart">
              <span className="activity-chart-value">{sum(activityStats.sessions)}</span>
              <span className="activity-chart-label">Sessions</span>
              <BarChart points={activityStats.sessions} />
            </div>
            <div className="activity-chart">
              <span className="activity-chart-value">
                {formatHours(sum(activityStats.recordingDurationSeconds))}
              </span>
              <span className="activity-chart-label">Durée enregistrée</span>
              <BarChart
                points={activityStats.recordingDurationSeconds}
                formatValue={formatHours}
              />
            </div>
          </div>
        )}
      </div>

      <p className="dashboard-footer">© {new Date().getFullYear()} Webinaire — Une solution UNCHK</p>
    </DashboardLayout>
  );
}
