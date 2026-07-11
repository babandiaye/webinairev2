import { useEffect, useState } from "react";
import { useDataChannel } from "@livekit/components-react";
import { PresentationDto } from "@webinairev2/shared-types";
import { egressApi } from "../../api/egressApi";
import { API_URL } from "../../api/client";

const CONTROL_TOPIC = "presentation";
const POLL_INTERVAL_MS = 4000;

export function EgressPresentationView({ roomId, token }: { roomId: string; token: string }) {
  const [active, setActive] = useState<PresentationDto | null>(null);

  function refresh() {
    egressApi.getActivePresentation(roomId, token).then(setActive).catch(() => {});
  }

  useDataChannel(CONTROL_TOPIC, () => refresh());

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [roomId]);

  const currentSlide = active?.slides.find((s) => s.index === active.currentSlideIndex);
  if (!active || !currentSlide) return null;

  return (
    <div className="presentation-overlay">
      <img src={`${API_URL}${currentSlide.imageUrl}`} alt={`Diapositive ${active.currentSlideIndex + 1}`} />
    </div>
  );
}
