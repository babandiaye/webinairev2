import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { CalendarPlus } from "lucide-react";
import { useAuth } from "../../auth/AuthProvider";
import { api } from "../../api/client";
import { DashboardLayout } from "../../components/layout/DashboardLayout";

// Extrait de l'ancien formulaire inline de HomePage.tsx (panneau "Actions
// rapides") — page dédiée, centrée, pour séparer consultation (tableau de
// bord) et création (planification) plutôt que de mélanger les deux.
export function SchedulePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;
  const canCreateRoom = user.role === "ADMIN" || user.role === "MODERATOR";
  if (!canCreateRoom) return <Navigate to="/" replace />;

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setError(null);
    setCreating(true);
    try {
      await api.createRoom({ title });
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setCreating(false);
    }
  }

  return (
    <DashboardLayout user={user} search="" onSearchChange={() => {}}>
      <div className="dashboard-welcome">
        <h2>Planifier un cours magistral</h2>
        <p>Créez une nouvelle salle pour votre prochain cours en direct.</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="schedule-panel panel">
        <form className="create-room-form" onSubmit={handleCreate}>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Titre du cours magistral"
          />
          <button className="btn btn-primary" type="submit" disabled={creating || !title.trim()}>
            <CalendarPlus size={16} />
            {creating ? "Création…" : "Créer"}
          </button>
        </form>
      </div>
    </DashboardLayout>
  );
}
