import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw, reconcileElements, CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { useDataChannel } from "@livekit/components-react";
import "@excalidraw/excalidraw/index.css";
import { egressApi } from "../../api/egressApi";

const DRAW_TOPIC = "wb";
const CONTROL_TOPIC = "wb-control";
const POLL_INTERVAL_MS = 4000;

// Rendu passif du tableau blanc pour le navigateur headless de Web Egress : ne
// dessine jamais (viewModeEnabled), se contente d'appliquer les mêmes messages
// que verrait un vrai participant — voir Whiteboard.tsx côté salle, dont ce
// composant doit reprendre exactement la logique de réception : Whiteboard.tsx
// ne diffuse plus que le DELTA des éléments modifiés (pas la scène complète,
// pour rester sous la limite ~15 Kio d'un paquet LiveKit), donc un simple
// updateScene({elements}) ici remplacerait toute la scène par ce delta partiel
// — chaque nouveau trait effaçant les précédents dans l'enregistrement.
// reconcileElements fusionne correctement par version, comme côté salle.
export function EgressWhiteboardView({ roomId, token }: { roomId: string; token: string }) {
  const [open, setOpen] = useState(false);
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);

  useDataChannel(DRAW_TOPIC, (msg) => {
    if (!excalidrawAPI) return;
    const senderIsModerator = (() => {
      try {
        return msg.from?.metadata ? JSON.parse(msg.from.metadata).isModerator === true : false;
      } catch {
        return false;
      }
    })();
    if (!senderIsModerator) return;

    try {
      const { elements } = JSON.parse(new TextDecoder().decode(msg.payload)) as {
        elements: RemoteExcalidrawElement[];
      };
      const reconciled = reconcileElements(
        excalidrawAPI.getSceneElements(),
        elements,
        excalidrawAPI.getAppState()
      );
      excalidrawAPI.updateScene({ elements: reconciled, captureUpdate: CaptureUpdateAction.NEVER });
      // Contrairement à Whiteboard.tsx (côté salle), pas de spectateur humain
      // ici donc pas de suivi désengageable ni de bouton de recadrage — on
      // recadre systématiquement sur chaque delta pour que l'enregistrement
      // vidéo garde tout le dessin dans le champ, quelle que soit son étendue.
      if (reconciled.length > 0) {
        excalidrawAPI.scrollToContent(reconciled, { fitToContent: true, animate: false });
      }
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

  const loadSnapshot = useCallback(() => {
    if (!excalidrawAPI) return;
    egressApi
      .getWhiteboard(roomId, token)
      .then((snapshot) => {
        const elements = (snapshot.sceneData as { elements?: OrderedExcalidrawElement[] } | null)?.elements;
        if (elements) {
          excalidrawAPI.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
          if (elements.length > 0) {
            excalidrawAPI.scrollToContent(elements, { fitToContent: true, animate: false });
          }
        }
      })
      .catch(() => {});
  }, [excalidrawAPI, roomId, token]);

  // Même garde qu'en salle (Whiteboard.tsx) : un seul chargement d'instantané
  // par ouverture, jamais en cours d'enregistrement.
  const loadedForOpenRef = useRef(false);
  useEffect(() => {
    if (!open) {
      loadedForOpenRef.current = false;
      return;
    }
    if (!excalidrawAPI || loadedForOpenRef.current) return;
    loadedForOpenRef.current = true;
    loadSnapshot();
  }, [excalidrawAPI, open, loadSnapshot]);

  if (!open) return null;

  return (
    <div className="whiteboard-overlay">
      <div className="whiteboard-canvas">
        <Excalidraw excalidrawAPI={(a) => setExcalidrawAPI(a)} viewModeEnabled zenModeEnabled />
      </div>
    </div>
  );
}
