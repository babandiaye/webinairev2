import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Role, UserDto } from "@webinairev2/shared-types";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { DashboardLayout } from "../../components/layout/DashboardLayout";
import { initialsOf } from "../../lib/initials";

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrateur",
  MODERATOR: "Modérateur",
  VIEWER: "Participant",
};

const ROLES: Role[] = ["ADMIN", "MODERATOR", "VIEWER"];

export function AdminUsersPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<UserDto[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.role !== "ADMIN") return;
    api.listUsers().then(setUsers).catch((e) => setError(e.message));
  }, [user]);

  if (!user) return null;
  if (user.role !== "ADMIN") return <Navigate to="/" replace />;

  async function handleRoleChange(targetId: string, role: Role) {
    setError(null);
    setPendingId(targetId);
    try {
      const updated = await api.updateUserRole(targetId, { role });
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setPendingId(null);
    }
  }

  const filteredUsers = users.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <DashboardLayout user={user} search={search} onSearchChange={setSearch}>
      <div className="dashboard-welcome">
        <h2>Utilisateurs et rôles</h2>
        <p>Gérez les rôles applicatifs des comptes provisionnés via Keycloak.</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="panel" style={{ marginTop: 20 }}>
        {filteredUsers.length === 0 ? (
          <p className="empty-state">Aucun utilisateur ne correspond.</p>
        ) : (
          <div className="users-list">
            {filteredUsers.map((u) => (
              <div className="user-row" key={u.id}>
                <div className="user-info">
                  <div className="avatar">{initialsOf(u.name)}</div>
                  <div>
                    <p className="user-name">{u.name}</p>
                    <span className="user-email">{u.email}</span>
                  </div>
                </div>
                <span className={`role-badge role-${u.role.toLowerCase()}`}>{ROLE_LABELS[u.role]}</span>
                <select
                  className="role-select"
                  value={u.role}
                  disabled={u.id === user.id || pendingId === u.id}
                  onChange={(e) => handleRoleChange(u.id, e.target.value as Role)}
                  title={u.id === user.id ? "Vous ne pouvez pas modifier votre propre rôle" : undefined}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
