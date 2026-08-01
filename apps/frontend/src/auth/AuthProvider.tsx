import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { UserDto } from "@webinairev2/shared-types";
import { api } from "../api/client";

interface AuthContextValue {
  user: UserDto | null;
  isLoading: boolean;
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const API_URL = import.meta.env.VITE_API_URL;

// L'échange OAuth (code, secret client, vérification de signature) se fait
// entièrement côté backend (client Keycloak confidentiel partagé avec
// unchk-monitor) — ce contexte se contente de lire/effacer le cookie de
// session posé par le backend, il ne fait plus aucune dance OIDC lui-même.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // 401 attendu et normal quand personne n'est connecté : pas une vraie erreur,
    // on retombe simplement sur user=null plutôt que de la propager.
    api
      .me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, []);

  const value: AuthContextValue = {
    user,
    isLoading,
    // Transmet la page en cours pour y revenir après Keycloak. Sans ça, un lien
    // profond ouvert sans session (typiquement une salle lancée depuis Moodle)
    // ramenait à l'accueil : l'utilisateur devait retrouver sa salle à la main,
    // et le paramètre returnUrl qui l'accompagne était perdu en route.
    // Le backend n'accepte que des chemins internes (voir sanitizeInternalPath).
    login: () => {
      const target = window.location.pathname + window.location.search + window.location.hash;
      window.location.href = `${API_URL}/auth/login?redirect=${encodeURIComponent(target)}`;
    },
    logout: () => {
      window.location.href = `${API_URL}/auth/logout`;
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé sous AuthProvider");
  return ctx;
}
