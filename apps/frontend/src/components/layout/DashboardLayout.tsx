import { ReactNode, useState } from "react";
import { UserDto } from "@webinairev2/shared-types";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function DashboardLayout({
  user,
  search,
  onSearchChange,
  children,
}: {
  user: UserDto;
  search: string;
  onSearchChange: (v: string) => void;
  children: ReactNode;
}) {
  // Tiroir de navigation mobile — la sidebar reste toujours montée (desktop la
  // garde visible via CSS), seul l'état "ouvert" change sa position sous le
  // breakpoint mobile (voir .sidebar dans styles.css).
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="dashboard-shell">
      <Sidebar role={user.role} open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <div className="main-area">
        <Topbar
          user={user}
          search={search}
          onSearchChange={onSearchChange}
          onMenuClick={() => setMobileNavOpen(true)}
        />
        <div className="dashboard-content">{children}</div>
      </div>
    </div>
  );
}
