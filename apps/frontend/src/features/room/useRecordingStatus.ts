import { useEffect, useState } from "react";
import { useDataChannel } from "@livekit/components-react";
import { RECORDING_CONTROL_TOPIC, RecordingDto, RecordingStatus } from "@webinairev2/shared-types";
import { api } from "../../api/client";

const RECORDING_POLL_INTERVAL_MS = 5000;
export const RECORDING_IN_PROGRESS_STATUSES: RecordingStatus[] = ["STARTING", "ACTIVE", "ENDING"];

// Partagé entre CallTopBar (affichage seul, pour tout le monde) et
// CallControlBar (bouton d'action, modérateur seulement) — chacun l'appelle
// indépendamment (léger doublon de polling) plutôt que de faire remonter un
// état partagé via un contexte, pour rester cohérent avec le reste de la
// salle où chaque panneau gère sa propre synchronisation.
export function useRecordingStatus(roomId: string) {
  const [activeRecording, setActiveRecording] = useState<RecordingDto | null>(null);

  function refresh() {
    api
      .listRecordings(roomId)
      .then((recordings) => {
        const active = recordings.find((r) => RECORDING_IN_PROGRESS_STATUSES.includes(r.status));
        setActiveRecording(active ?? null);
      })
      .catch(() => {});
  }

  const { send } = useDataChannel(RECORDING_CONTROL_TOPIC, () => refresh());

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, RECORDING_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [roomId]);

  function notifyOthers() {
    send(new TextEncoder().encode("updated"), { reliable: true });
  }

  return { activeRecording, refresh, notifyOthers };
}
