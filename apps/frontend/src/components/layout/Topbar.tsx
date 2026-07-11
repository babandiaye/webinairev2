import { LogOut, Search } from "lucide-react";
import { UserDto } from "@webinairev2/shared-types";
import { initialsOf } from "../../lib/initials";
import { useAuth } from "../../auth/AuthProvider";

const ROLE_LABELS: Record<UserDto["role"], string> = {
  ADMIN: "Administrateur",
  MODERATOR: "Modérateur",
  VIEWER: "Participant",
};

export function Topbar({
  user,
  search,
  onSearchChange,
}: {
  user: UserDto;
  search: string;
  onSearchChange: (v: string) => void;
}) {
  const { logout } = useAuth();
  const initials = initialsOf(user.name);

  return (
    <header className="topbar">
      <div className="topbar-search">
        <Search size={16} />
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Rechercher une réunion…"
        />
      </div>

      <div className="topbar-user">
        <div className="avatar">{initials}</div>
        <div className="topbar-user-info">
          <div className="topbar-user-name">{user.name}</div>
          <div className="topbar-user-role">{ROLE_LABELS[user.role]}</div>
        </div>
        <button className="logout-btn" onClick={logout} title="Se déconnecter" aria-label="Se déconnecter">
          <LogOut size={17} />
        </button>
      </div>
    </header>
  );
}
