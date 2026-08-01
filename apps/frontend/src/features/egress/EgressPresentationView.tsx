import { useEffect, useState } from "react";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent } from "livekit-client";
import { PresentationDto } from "@webinairev2/shared-types";
import { egressApi } from "../../api/egressApi";
import { API_URL } from "../../api/client";

const CONTROL_TOPIC = "presentation";
const POLL_INTERVAL_MS = 4000;

export function EgressPresentationView({ roomId, token }: { roomId: string; token: string }) {
  const room = useRoomContext();
  const [active, setActive] = useState<PresentationDto | null>(null);

  function refresh() {
    egressApi.getActivePresentation(roomId, token).then(setActive).catch(() => {});
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [roomId]);

  // room.on direct plutôt que useDataChannel(TOPIC, callbackEnLigne) — voir
  // Whiteboard.tsx pour le détail complet du défaut que ça corrige
  // (réabonnement de room.on(DataReceived) à chaque rendu, perte silencieuse
  // de tout message reçu pendant la fenêtre de coupure). Ici, le sondage
  // périodique ci-dessus (4 s) sert déjà de secours — le correctif reste
  // justifié pour la cohérence et la réactivité, pas pour combler une absence
  // totale de rattrapage.
  useEffect(() => {
    function handleData(_payload: Uint8Array, _participant: unknown, _kind: unknown, topic?: string) {
      if (topic === CONTROL_TOPIC) refresh();
    }
    room.on(RoomEvent.DataReceived, handleData);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
    };
  }, [room, roomId]);

  const currentSlide = active?.slides.find((s) => s.index === active.currentSlideIndex);
  if (!active || !currentSlide) return null;

  return (
    <div className="presentation-overlay">
      <img src={`${API_URL}${currentSlide.imageUrl}`} alt={`Diapositive ${active.currentSlideIndex + 1}`} />
    </div>
  );
}
