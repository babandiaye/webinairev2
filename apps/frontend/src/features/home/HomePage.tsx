import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarPlus, CalendarClock, Radio, CheckCircle2, DoorOpen, Users, Video, ClipboardList, Trash2, UserCog } from "lucide-react";
import { RoomDto } from "@webinairev2/shared-types";
import { useAuth } from "../../auth/AuthProvider";
import { api } from "../../api/client";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { StatCard } from "../../components/ui/StatCard";
import { DashboardLayout } from "../../components/layout/DashboardLayout";

const MONTHS = ["JAN", "FÉV", "MAR", "AVR", "MAI", "JUIN", "JUIL", "AOÛT", "SEP", "OCT", "NOV", "DÉC"];

export function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<RoomDto[]>([]);
  // Comptes plateforme, réservés à l'admin (endpoints /users et /recordings
  // globaux gardés ADMIN côté backend — inutile de les appeler sinon).
  const [userCount, setUserCount] = useState<number | null>(null);
  const [recordingCount, setRecordingCount] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

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

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      const room = await api.createRoom({ title });
      setRooms((prev) => [room, ...prev]);
      setTitle("");
      setShowCreateForm(false);
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
      scheduled: rooms.filter((r) => r.status === "SCHEDULED").length,
      ended: rooms.filter((r) => r.status === "ENDED").length,
    }),
    [rooms]
  );

  if (!user) return null;
  const canCreateRoom = user.role === "ADMIN" || user.role === "MODERATOR";

  return (
    <DashboardLayout user={user} search={search} onSearchChange={setSearch}>
      <div className="dashboard-welcome">
        <h2>Bienvenue, {user.givenName} 👋</h2>
        <p>Voici ce qui se passe sur votre plateforme Webinaire aujourd'hui.</p>
      </div>

      <div className="stat-grid">
        <StatCard label="Salles totales" value={stats.total} icon={DoorOpen} color="#2563eb" />
        <StatCard label="En direct" value={stats.live} icon={Radio} color="#dc2626" pulse />
        <StatCard label="Programmées" value={stats.scheduled} icon={CalendarClock} color="#d97706" />
        <StatCard label="Terminées" value={stats.ended} icon={CheckCircle2} color="#15803d" />
        {isAdmin && userCount !== null && (
          <StatCard
            label="Utilisateurs"
            value={userCount}
            icon={Users}
            color="#7c3aed"
            onClick={() => navigate("/admin/users")}
          />
        )}
        {isAdmin && recordingCount !== null && (
          <StatCard
            label="Enregistrements"
            value={recordingCount}
            icon={Video}
            color="#0891b2"
            onClick={() => navigate("/recordings")}
          />
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="dashboard-grid">
        <div className="panel">
          <div className="panel-header">
            <h3>Réunions récentes</h3>
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
                      <p className="meeting-title">{room.title}</p>
                      <span className="meeting-sub">Salle : {room.roomName}</span>
                    </div>
                    <div className="meeting-actions">
                      <StatusBadge status={room.status} />
                      <button className="btn btn-ghost" onClick={() => navigate(`/rooms/${room.id}/recordings`)}>
                        <Video size={15} />
                        Enregistrements
                      </button>
                      {(user.role === "ADMIN" || user.id === room.creatorId) && (
                        <button className="btn btn-ghost" onClick={() => navigate(`/rooms/${room.id}/attendance`)}>
                          <ClipboardList size={15} />
                          Présence
                        </button>
                      )}
                      {(room.status !== "ENDED" || canCreateRoom) && (
                        <button className="btn btn-primary" onClick={() => navigate(`/rooms/${room.id}`)}>
                          {room.status === "ENDED" ? "Redémarrer" : "Rejoindre"}
                        </button>
                      )}
                      {(user.role === "ADMIN" || user.id === room.creatorId) && room.status !== "LIVE" && (
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

            {canCreateRoom && showCreateForm && (
              <form className="create-room-form" onSubmit={handleCreate}>
                <input
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Titre de la salle"
                />
                <button className="btn btn-primary" type="submit" disabled={!title.trim()}>
                  Créer
                </button>
              </form>
            )}

            <div className="quick-actions">
              {canCreateRoom && (
                <button className="quick-action-btn" onClick={() => setShowCreateForm((v) => !v)}>
                  <CalendarPlus size={16} />
                  Planifier une réunion
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

      <p className="dashboard-footer">© {new Date().getFullYear()} Webinaire — Une solution UNCHK</p>
    </DashboardLayout>
  );
}
