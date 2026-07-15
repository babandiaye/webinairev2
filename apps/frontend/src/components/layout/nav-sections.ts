import {
  LayoutDashboard,
  CalendarPlus,
  Video,
  UserCog,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  icon: LucideIcon;
  to: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
  // Section réservée aux administrateurs.
  adminOnly?: boolean;
}

export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Réunions",
    items: [
      { label: "Tableau de bord", icon: LayoutDashboard, to: "/" },
      { label: "Planifier une réunion", icon: CalendarPlus, to: "/" },
    ],
  },
  {
    title: "Enregistrements",
    // Vue globale toutes salles confondues — réservée admin (RecordingsController.listAll).
    // Un modérateur garde son accès par salle depuis le tableau de bord (bouton
    // "Enregistrements" sur chaque réunion), pas besoin de cette entrée pour lui.
    adminOnly: true,
    items: [{ label: "Enregistrements", icon: Video, to: "/recordings" }],
  },
  {
    title: "Administration",
    adminOnly: true,
    items: [{ label: "Utilisateurs et rôles", icon: UserCog, to: "/admin/users" }],
  },
];
