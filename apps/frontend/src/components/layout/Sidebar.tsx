import { Video, Moon, Sun } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { NAV_SECTIONS } from "./nav-sections";
import { useTheme } from "../../theme/ThemeProvider";
import type { Role } from "@webinairev2/shared-types";

export function Sidebar({ role }: { role: Role }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggle } = useTheme();

  const sections = NAV_SECTIONS.filter((s) => !s.adminOnly || role === "ADMIN");

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <Video size={20} />
        </div>
        <div>
          <div className="sidebar-title">Webinaire</div>
          <div className="sidebar-subtitle">Plateforme de webinaires</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {sections.map((section) => (
          <div className="nav-section" key={section.title}>
            <div className="nav-section-title">{section.title}</div>
            {section.items.map((item) => {
              const Icon = item.icon;
              const isActive = !!item.to && location.pathname === item.to;
              return (
                <button
                  key={item.label}
                  className={`nav-item ${isActive ? "active" : ""} ${!item.available ? "disabled" : ""}`}
                  disabled={!item.available}
                  onClick={() => item.to && navigate(item.to)}
                >
                  <Icon size={17} />
                  <span>{item.label}</span>
                  {!item.available && <span className="soon-badge">Bientôt</span>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="theme-toggle-row">
          <span>Mode sombre</span>
          <button
            className={`theme-switch ${theme === "dark" ? "on" : ""}`}
            onClick={toggle}
            aria-label="Basculer le mode sombre"
          />
        </div>
        <div className="theme-toggle-row" style={{ justifyContent: "flex-start", gap: 6 }}>
          {theme === "dark" ? <Moon size={13} /> : <Sun size={13} />}
          <span>{theme === "dark" ? "Sombre" : "Clair"}</span>
        </div>
        <div className="app-version">
          <Video size={14} />
          webinairev2 · v0.1.0
        </div>
      </div>
    </aside>
  );
}
