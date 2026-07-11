import { ReactNode } from "react";
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
  return (
    <div className="dashboard-shell">
      <Sidebar role={user.role} />
      <div className="main-area">
        <Topbar user={user} search={search} onSearchChange={onSearchChange} />
        <div className="dashboard-content">{children}</div>
      </div>
    </div>
  );
}
