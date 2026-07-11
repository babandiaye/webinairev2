import {
  LayoutDashboard,
  CalendarPlus,
  DoorOpen,
  Users,
  Mail,
  Video,
  HardDrive,
  BarChart3,
  Activity,
  Settings,
  UserCog,
  Plug,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  icon: LucideIcon;
  to?: string;
  available: boolean;
}

export interface NavSection {
  title: string;
  items: NavItem[];
  // Section réservée aux administrateurs (roadmap produit, pas encore de vraies pages)
  adminOnly?: boolean;
}

// available:false = fonctionnalité pas encore développée (jalons 2-6 du plan) —
// affichée avec un badge "Bientôt" plutôt qu'une page factice à données inventées.
export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Réunions",
    items: [
      { label: "Tableau de bord", icon: LayoutDashboard, to: "/", available: true },
      { label: "Planifier une réunion", icon: CalendarPlus, to: "/", available: true },
      { label: "Salles permanentes", icon: DoorOpen, available: false },
      { label: "Participants", icon: Users, available: false },
      { label: "Invitations", icon: Mail, available: false },
    ],
  },
  {
    title: "Enregistrements",
    items: [
      { label: "Enregistrements", icon: Video, available: false },
      { label: "Stockage", icon: HardDrive, available: false },
    ],
  },
  {
    title: "Statistiques",
    items: [
      { label: "Rapports", icon: BarChart3, available: false },
      { label: "Activité en direct", icon: Activity, available: false },
    ],
  },
  {
    title: "Paramètres",
    adminOnly: true,
    items: [
      { label: "Paramètres généraux", icon: Settings, available: false },
      { label: "Utilisateurs et rôles", icon: UserCog, to: "/admin/users", available: true },
      { label: "Intégrations", icon: Plug, available: false },
    ],
  },
];
