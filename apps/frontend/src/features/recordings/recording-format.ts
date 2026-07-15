import { RecordingDto } from "@webinairev2/shared-types";

// Partagé entre RecordingsPage (une salle) et AllRecordingsPage (globale, admin).
export const STATUS_LABELS: Record<RecordingDto["status"], string> = {
  STARTING: "Démarrage…",
  ACTIVE: "Enregistrement en cours",
  ENDING: "Finalisation…",
  READY: "Disponible",
  FAILED: "Échec",
};

export const STATUS_BADGE_CLASS: Record<RecordingDto["status"], string> = {
  STARTING: "scheduled",
  ACTIVE: "live",
  ENDING: "scheduled",
  READY: "ended",
  FAILED: "failed",
};

export function formatDuration(seconds: number | null) {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m${s.toString().padStart(2, "0")}`;
}

export function formatSize(bytes: string | null) {
  if (!bytes) return "—";
  const mb = Number(bytes) / (1024 * 1024);
  return `${mb.toFixed(1)} Mo`;
}
