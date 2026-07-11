import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarPlus, CalendarClock, Radio, CheckCircle2, DoorOpen, Users, Mail, Video, ClipboardList } from "lucide-react";
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
  const [search, setSearch] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listRooms().then(setRooms).catch((e) => setError(e.message));
  }, []);

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
        <StatCard label="En direct" value={stats.live} icon={Radio} color="#dc2626" />
        <StatCard label="Programmées" value={stats.scheduled} icon={CalendarClock} color="#d97706" />
        <StatCard label="Terminées" value={stats.ended} icon={CheckCircle2} color="#15803d" />
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
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

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
              <button
                className="quick-action-btn"
                onClick={() => setShowCreateForm((v) => !v)}
              >
                <CalendarPlus size={16} />
                Planifier une réunion
              </button>
            )}
            <button className="quick-action-btn disabled" disabled>
              <DoorOpen size={16} />
              Créer une salle permanente
              <span className="soon-badge">Bientôt</span>
            </button>
            <button className="quick-action-btn disabled" disabled>
              <Users size={16} />
              Importer des utilisateurs
              <span className="soon-badge">Bientôt</span>
            </button>
            <button className="quick-action-btn disabled" disabled>
              <Mail size={16} />
              Gérer les invitations
              <span className="soon-badge">Bientôt</span>
            </button>
          </div>
        </div>
      </div>

      <p className="dashboard-footer">© {new Date().getFullYear()} Webinaire — Une solution UNCHK</p>
    </DashboardLayout>
  );
}
