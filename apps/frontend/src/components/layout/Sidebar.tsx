import { Video, Moon, Sun } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { NAV_SECTIONS } from "./nav-sections";
import { useTheme } from "../../theme/ThemeProvider";
import type { Role } from "@webinairev2/shared-types";
import logo from "../../assets/logo-webinairev2.png";

export function Sidebar({
  role,
  open,
  onClose,
}: {
  role: Role;
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggle } = useTheme();

  const sections = NAV_SECTIONS.filter((s) => !s.adminOnly || role === "ADMIN");

  function handleNavigate(to: string) {
    navigate(to);
    // Sur mobile la navigation se fait depuis un tiroir superposé au contenu —
    // le refermer après un clic évite qu'il reste ouvert par-dessus la nouvelle page.
    onClose();
  }

  return (
    <>
      {open && <div className="sidebar-backdrop" onClick={onClose} />}
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="sidebar-header">
          <img src={logo} alt="Webinaire — Plateforme de webinaires" className="sidebar-brand-logo" />
        </div>

        <nav className="sidebar-nav">
          {sections.map((section) => (
            <div className="nav-section" key={section.title}>
              <div className="nav-section-title">{section.title}</div>
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.to;
                return (
                  <button
                    key={item.label}
                    className={`nav-item ${isActive ? "active" : ""}`}
                    onClick={() => handleNavigate(item.to)}
                  >
                    <Icon size={17} />
                    <span>{item.label}</span>
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
    </>
  );
}
