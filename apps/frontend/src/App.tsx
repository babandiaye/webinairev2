import { Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import { HomePage } from "./features/home/HomePage";
import { RoomPage } from "./features/room/RoomPage";
import { RecordingsPage } from "./features/recordings/RecordingsPage";
import { AllRecordingsPage } from "./features/recordings/AllRecordingsPage";
import { AttendancePage } from "./features/attendance/AttendancePage";
import { AdminUsersPage } from "./features/admin/AdminUsersPage";
import { StatusPage } from "./features/admin/StatusPage";
import { EgressRoomView } from "./features/egress/EgressRoomView";

function ProtectedRoute({ children }: { children: JSX.Element }) {
  const { user, isLoading, login } = useAuth();

  if (isLoading) return <div className="loading-screen">Chargement…</div>;
  if (!user) {
    login();
    return <div className="loading-screen">Redirection vers la connexion…</div>;
  }
  return children;
}

export function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <HomePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/rooms/:id"
        element={
          <ProtectedRoute>
            <RoomPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/recordings"
        element={
          <ProtectedRoute>
            <AllRecordingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/rooms/:id/recordings"
        element={
          <ProtectedRoute>
            <RecordingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/rooms/:id/attendance"
        element={
          <ProtectedRoute>
            <AttendancePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/users"
        element={
          <ProtectedRoute>
            <AdminUsersPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/status"
        element={
          <ProtectedRoute>
            <StatusPage />
          </ProtectedRoute>
        }
      />
      {/* Chargée par le Chrome headless de LiveKit Web Egress — jamais par un
          utilisateur, pas de ProtectedRoute (pas de session Keycloak possible). */}
      <Route path="/egress-view/:id" element={<EgressRoomView />} />
    </Routes>
  );
}
