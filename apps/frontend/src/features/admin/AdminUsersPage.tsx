import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { Ban, CheckCircle2, Download, Trash2, Upload, UserPlus } from "lucide-react";
import { AdminUserDto, Role } from "@webinairev2/shared-types";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { DashboardLayout } from "../../components/layout/DashboardLayout";
import { initialsOf } from "../../lib/initials";
import { ROLE_LABELS, ROLES } from "../../lib/roleLabels";

export function AdminUsersPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<AdminUserDto[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newFirstName, setNewFirstName] = useState("");
  const [newLastName, setNewLastName] = useState("");
  const [newRole, setNewRole] = useState<Role>("VIEWER");
  const [creating, setCreating] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<string | null>(null);

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

  async function handleToggleActive(target: AdminUserDto) {
    setError(null);
    setPendingId(target.id);
    try {
      const updated = await api.setUserActive(target.id, !target.active);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setPendingId(null);
    }
  }

  async function handleDelete(target: AdminUserDto) {
    if (!confirm(`Supprimer définitivement ${target.name} ?`)) return;
    setError(null);
    setPendingId(target.id);
    try {
      await api.deleteUser(target.id);
      setUsers((prev) => prev.filter((u) => u.id !== target.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setPendingId(null);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const name = [newFirstName.trim(), newLastName.trim()].filter(Boolean).join(" ");
    if (!newEmail.trim() || !name) return;
    setError(null);
    setCreating(true);
    try {
      const created = await api.createUser({ email: newEmail.trim(), name, role: newRole });
      setUsers((prev) => [...prev, created]);
      setNewEmail("");
      setNewFirstName("");
      setNewLastName("");
      setNewRole("VIEWER");
      setShowCreateForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setCreating(false);
    }
  }

  async function handleImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permet de resélectionner le même fichier ensuite
    if (!file) return;
    setError(null);
    setImportSummary(null);
    setImporting(true);
    try {
      const summary = await api.importUsersCsv(file);
      setImportSummary(
        `${summary.created} compte(s) créé(s), ${summary.skipped} déjà existant(s) sur ${summary.total} email(s) valide(s).`
      );
      const refreshed = await api.listUsers();
      setUsers(refreshed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setImporting(false);
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
      {importSummary && <div className="info-banner">{importSummary}</div>}

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="panel-header">
          <h3>Comptes ({users.length})</h3>
          <div className="panel-header-actions">
            <a className="btn btn-ghost" href={api.csvTemplateUrl} download>
              <Download size={15} />
              Modèle CSV
            </a>
            <button className="btn btn-ghost" disabled={importing} onClick={() => fileInputRef.current?.click()}>
              <Upload size={15} />
              {importing ? "Import…" : "Importer un CSV"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: "none" }}
              onChange={handleImportFile}
            />
            <button className="btn btn-ghost" onClick={() => setShowCreateForm((v) => !v)}>
              <UserPlus size={15} />
              Créer un utilisateur
            </button>
          </div>
        </div>

        {showCreateForm && (
          <form className="create-room-form" onSubmit={handleCreate}>
            <input
              autoFocus
              value={newFirstName}
              onChange={(e) => setNewFirstName(e.target.value)}
              placeholder="Prénom"
              required
            />
            <input
              value={newLastName}
              onChange={(e) => setNewLastName(e.target.value)}
              placeholder="Nom"
              required
            />
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="email@unchk.edu.sn"
              required
            />
            <select className="role-select" value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <button
              className="btn btn-primary"
              type="submit"
              disabled={creating || !newEmail.trim() || !newFirstName.trim() || !newLastName.trim()}
            >
              Créer
            </button>
          </form>
        )}

        {filteredUsers.length === 0 ? (
          <p className="empty-state">Aucun utilisateur ne correspond.</p>
        ) : (
          <div className="users-list">
            {filteredUsers.map((u) => {
              const isSelf = u.id === user.id;
              const busy = pendingId === u.id;
              return (
                <div className={`user-row ${!u.active ? "user-row-inactive" : ""}`} key={u.id}>
                  <div className="user-info">
                    <div className="avatar">{initialsOf(u.name)}</div>
                    <div>
                      <p className="user-name">
                        {u.name}
                        {!u.active && <span className="user-inactive-tag">Désactivé</span>}
                      </p>
                      <span className="user-email">{u.email}</span>
                      {u.roomCount > 0 && (
                        <span className="user-room-count">
                          {u.roomCount} salle{u.roomCount > 1 ? "s" : ""} créée{u.roomCount > 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="user-controls">
                    <span className={`role-badge role-${u.role.toLowerCase()}`}>{ROLE_LABELS[u.role]}</span>
                    <select
                      className="role-select"
                      value={u.role}
                      disabled={isSelf || busy}
                      onChange={(e) => handleRoleChange(u.id, e.target.value as Role)}
                      title={isSelf ? "Vous ne pouvez pas modifier votre propre rôle" : undefined}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                    <div className="user-actions">
                      <button
                        className="btn btn-ghost"
                        disabled={isSelf || busy}
                        title={isSelf ? "Vous ne pouvez pas désactiver votre propre compte" : u.active ? "Désactiver" : "Réactiver"}
                        onClick={() => handleToggleActive(u)}
                      >
                        {u.active ? <Ban size={15} /> : <CheckCircle2 size={15} />}
                      </button>
                      <button
                        className="btn btn-danger"
                        disabled={isSelf || busy || u.roomCount > 0}
                        title={
                          isSelf
                            ? "Vous ne pouvez pas supprimer votre propre compte"
                            : u.roomCount > 0
                              ? "Ce compte a créé des salles : supprimez-les d'abord"
                              : "Supprimer"
                        }
                        onClick={() => handleDelete(u)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
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
