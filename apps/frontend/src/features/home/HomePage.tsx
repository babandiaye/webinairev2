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
import { ActivityStatsDto, RoomDto, StatsBucket, StatsRange } from "@webinairev2/shared-types";
import { useAuth } from "../../auth/AuthProvider";
import { api } from "../../api/client";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { StatItem } from "../../components/ui/StatItem";
import { DashboardLayout } from "../../components/layout/DashboardLayout";
import { BarChart } from "../../components/charts/BarChart";

const MONTHS = ["JAN", "FÉV", "MAR", "AVR", "MAI", "JUIN", "JUIL", "AOÛT", "SEP", "OCT", "NOV", "DÉC"];

// L'année est agrégée par mois côté serveur (voir StatsService) : le sélecteur
// ne fait que demander une plage, il n'a pas à connaître la granularité.
const RANGES: { value: StatsRange; label: string }[] = [
  { value: "week", label: "Semaine" },
  { value: "month", label: "Mois" },
  { value: "year", label: "Année" },
];

function sum(points: { value: number }[]): number {
  return points.reduce((acc, p) => acc + p.value, 0);
}

/**
 * Durée cumulée d'enregistrement, dans l'unité que la valeur appelle.
 *
 * En dessous d'une heure, l'heure décimale est illisible : « 0,4 h » ne dit
 * rien à personne, « 25 min » se comprend d'un coup d'œil. Au-delà, l'inverse
 * devient vrai — « 372 min » demande un calcul mental que « 6,2 h » évite.
 */
function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0 min";
  // Une capture de quelques secondes existe (test, faux départ) : l'arrondi la
  // ramènerait à « 0 min », ce qui se lirait comme une absence d'enregistrement.
  if (totalSeconds < 60) return "< 1 min";

  // Le seuil porte sur les minutes ARRONDIES, pas sur les secondes : 3 599 s
  // valent 59,98 min, donc passeraient le test « moins d'une heure » pour
  // s'afficher « 60 min ».
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return `${minutes} min`;

  const hours = totalSeconds / 3600;
  return `${hours.toLocaleString("fr-FR", {
    maximumFractionDigits: hours < 10 ? 1 : 0,
  })} h`;
}

const DAY_LABEL = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" });
const MONTH_LABEL = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });

/** Libellé d'un point du graphe, selon la granularité renvoyée par le serveur. */
function formatPointLabel(date: string, bucket: StatsBucket): string {
  // Midi UTC et non minuit : la date brute "2026-08-01" est interprétée en UTC,
  // et un fuseau à l'ouest la ferait basculer à la veille à l'affichage.
  const d = new Date(`${date}T12:00:00Z`);
  return bucket === "month" ? MONTH_LABEL.format(d) : DAY_LABEL.format(d);
}

const HOUR = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

/** Horaire lisible d'une salle, tel qu'affiché sous son titre. */
function formatSchedule(room: RoomDto): string {
  if (!room.startedAt) return "Pas encore démarrée";
  const start = HOUR.format(new Date(room.startedAt));
  if (room.status === "LIVE") return `En cours depuis ${start}`;
  if (!room.endedAt) return `Démarrée à ${start}`;
  return `${start} – ${HOUR.format(new Date(room.endedAt))}`;
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

      {/* Bandeau unique et non cinq cartes : les libellés portent leur propre
          qualificatif, ce qui supprime la troisième ligne grise ("Total",
          "En cours", "Aujourd'hui"…) qui ne faisait que répéter l'intitulé. */}
      <div className="stat-rail">
        <StatItem label="Salles au total" value={stats.total} icon={DoorOpen} />
        <StatItem label="En direct" value={stats.live} icon={Radio} alert />
        <StatItem label="Terminées aujourd'hui" value={stats.ended} icon={CheckCircle2} />
        {isAdmin && userCount !== null && (
          <StatItem
            label="Utilisateurs inscrits"
            value={userCount}
            icon={Users}
            onClick={() => navigate("/admin/users")}
          />
        )}
        {isAdmin && recordingCount !== null && (
          <StatItem
            label="Enregistrements"
            value={recordingCount}
            icon={Video}
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
                // Ouvre-t-il une séance, ou en rejoint-il une qui tourne déjà ?
                // Un participant sur une salle planifiée « rejoint » lui aussi :
                // il atterrit sur l'écran d'attente jusqu'à l'arrivée d'un
                // animateur, il ne démarre rien.
                const startsSession = room.status !== "LIVE" && room.canManage;
                return (
                  // Le nom LiveKit passe en infobulle : c'est un identifiant
                  // technique dont personne n'a l'usage à la lecture, mais qui
                  // sert à corréler avec les logs quand on le cherche.
                  <div className="meeting-row" key={room.id} title={`Salle LiveKit : ${room.roomName}`}>
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
                      {/* À la place de l'identifiant de salle : l'horaire, seule
                          information de cette ligne qu'un humain lit vraiment. */}
                      <span className="meeting-sub">{formatSchedule(room)}</span>
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
                      {/* Trois états, deux verbes, et le droit RÉEL sur cette
                          salle-là :
                            en direct  → Rejoindre, pour tout le monde ;
                            planifiée  → Démarrer pour qui peut la gérer,
                                         Rejoindre sinon (salle d'attente) ;
                            terminée   → Démarrer, gestionnaires seuls.
                          « Redémarrer » laissait croire à une reprise : join()
                          repart d'un tableau blanc vierge et remet le statut à
                          SCHEDULED, c'est bien une NOUVELLE séance. Le mot est
                          aussi celui du plugin Moodle, pour que les deux
                          surfaces nomment la même action pareil.
                          La condition suit room.canManage — le droit réel sur
                          CETTE salle, calculé par le serveur avec la règle
                          exacte de join() — et non le rôle global. Sans effet
                          pour un modérateur : list() ne lui renvoie que des
                          salles dont il est créateur ou inscrit (l'enseignant
                          venu de Moodle y est auto-inscrit par syncUser), donc
                          canManage y vaut toujours vrai. Ça rattrape en
                          revanche le créateur rétrogradé en VIEWER depuis
                          /admin/users : l'API le laisse toujours relancer SA
                          salle, le tableau de bord lui masquait le bouton.
                          Deux verbes, deux couleurs pleines : bleu pour ouvrir
                          une séance, vert pour entrer dans une séance qui
                          tourne. La pastille de statut, à gauche, continue de
                          porter l'état ; le bouton porte l'action. Ce sont les
                          trois actions voisines, sans bordure au repos, qui
                          donnent le contraste — pas la retenue du bouton. */}
                      {(room.status !== "ENDED" || room.canManage) && (
                        <button
                          className={`btn ${startsSession ? "btn-primary" : "btn-join"}`}
                          onClick={() => navigate(`/rooms/${room.id}`)}
                        >
                          {startsSession ? "Démarrer" : "Rejoindre"}
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
            {RANGES.map(({ value, label }) => (
              <button
                key={value}
                className={statsRange === value ? "active" : ""}
                aria-pressed={statsRange === value}
                onClick={() => setStatsRange(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {activityStats && (
          <div className="activity-grid">
            <div className="activity-chart">
              <span className="activity-chart-value">{sum(activityStats.rooms)}</span>
              <span className="activity-chart-label">Cours (CM) créés</span>
              <BarChart
                points={activityStats.rooms}
                formatLabel={(d) => formatPointLabel(d, activityStats.bucket)}
              />
            </div>
            <div className="activity-chart">
              <span className="activity-chart-value">{sum(activityStats.sessions)}</span>
              <span className="activity-chart-label">Sessions</span>
              <BarChart
                points={activityStats.sessions}
                formatLabel={(d) => formatPointLabel(d, activityStats.bucket)}
              />
            </div>
            <div className="activity-chart">
              <span className="activity-chart-value">
                {formatDuration(sum(activityStats.recordingDurationSeconds))}
              </span>
              <span className="activity-chart-label">Durée enregistrée</span>
              <BarChart
                points={activityStats.recordingDurationSeconds}
                formatValue={formatDuration}
                formatLabel={(d) => formatPointLabel(d, activityStats.bucket)}
              />
            </div>
          </div>
        )}
      </div>

      <p className="dashboard-footer">© {new Date().getFullYear()} Webinaire — Une solution UNCHK</p>
    </DashboardLayout>
  );
}
