import { useEffect, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useDataChannel } from "@livekit/components-react";
import "@excalidraw/excalidraw/index.css";
import { egressApi } from "../../api/egressApi";

const DRAW_TOPIC = "wb";
const CONTROL_TOPIC = "wb-control";
const POLL_INTERVAL_MS = 4000;

// Rendu passif du tableau blanc pour le navigateur headless de Web Egress : ne
// dessine jamais (viewModeEnabled), se contente d'appliquer les mêmes messages
// que verrait un vrai participant (voir Whiteboard.tsx côté salle).
export function EgressWhiteboardView({ roomId, token }: { roomId: string; token: string }) {
  const [open, setOpen] = useState(false);
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);

  useDataChannel(DRAW_TOPIC, (msg) => {
    if (!excalidrawAPI) return;
    try {
      const { elements } = JSON.parse(new TextDecoder().decode(msg.payload));
      excalidrawAPI.updateScene({ elements });
    } catch {
      // message malformé ignoré
    }
  });

  useDataChannel(CONTROL_TOPIC, () => refreshState());

  function refreshState() {
    egressApi
      .getWhiteboardState(roomId, token)
      .then((s) => setOpen(s.open))
      .catch(() => {});
  }

  useEffect(() => {
    refreshState();
    const interval = setInterval(refreshState, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [roomId]);

  useEffect(() => {
    if (!excalidrawAPI || !open) return;
    egressApi
      .getWhiteboard(roomId, token)
      .then((snapshot) => {
        const elements = (snapshot.sceneData as { elements?: unknown[] } | null)?.elements;
        if (elements) excalidrawAPI.updateScene({ elements: elements as any });
      })
      .catch(() => {});
  }, [excalidrawAPI, open, roomId]);

  if (!open) return null;

  return (
    <div className="whiteboard-overlay">
      <div className="whiteboard-canvas">
        <Excalidraw excalidrawAPI={(a) => setExcalidrawAPI(a)} viewModeEnabled zenModeEnabled />
      </div>
    </div>
  );
}
