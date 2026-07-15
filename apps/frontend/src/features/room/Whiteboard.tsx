import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useDataChannel } from "@livekit/components-react";
import "@excalidraw/excalidraw/index.css";
import { api } from "../../api/client";

const DRAW_TOPIC = "wb";
const CONTROL_TOPIC = "wb-control";
const BROADCAST_DEBOUNCE_MS = 300;
const SAVE_DEBOUNCE_MS = 3000;
const POLL_INTERVAL_MS = 4000;

// Session partagée : ouverte/fermée pour tout le monde à la fois, pas un simple
// panneau d'affichage local — sinon les autres participants ne voient jamais le
// tableau blanc apparaître quand quelqu'un l'ouvre de son côté.
export function Whiteboard({ roomId, canManage }: { roomId: string; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  // Évite la boucle de rediffusion : un updateScene() déclenché par un message
  // reçu déclenche aussi onChange(), qu'il ne faut surtout pas rebroadcaster.
  const applyingRemoteRef = useRef(false);
  const broadcastTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const { send: sendDraw } = useDataChannel(DRAW_TOPIC, (msg) => {
    if (!excalidrawAPI) return;
    try {
      const { elements } = JSON.parse(new TextDecoder().decode(msg.payload));
      applyingRemoteRef.current = true;
      excalidrawAPI.updateScene({ elements });
    } catch {
      // message malformé ignoré
    } finally {
      applyingRemoteRef.current = false;
    }
  });

  const { send: sendControl } = useDataChannel(CONTROL_TOPIC, () => {
    refreshState();
  });

  function refreshState() {
    api.getWhiteboardState(roomId).then((s) => setOpen(s.open)).catch(() => {});
  }

  useEffect(() => {
    refreshState();
    const interval = setInterval(refreshState, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [roomId]);

  // Ne recharge l'instantané serveur qu'une seule fois par ouverture — sinon,
  // si excalidrawAPI change de référence pendant que quelqu'un écrit (Excalidraw
  // peut rappeler excalidrawAPI(...) plus d'une fois), cet effet se redéclenche
  // et écrase le dessin en cours avec le dernier instantané SAUVEGARDÉ, potentiellement
  // vieux de plusieurs secondes (SAVE_DEBOUNCE_MS) — symptôme : le trait qu'on
  // vient de tracer disparaît immédiatement.
  const loadedForOpenRef = useRef(false);
  useEffect(() => {
    if (!open) {
      loadedForOpenRef.current = false;
      return;
    }
    if (!excalidrawAPI || loadedForOpenRef.current) return;
    loadedForOpenRef.current = true;

    api
      .getWhiteboard(roomId)
      .then((snapshot) => {
        const elements = (snapshot.sceneData as { elements?: unknown[] } | null)?.elements;
        if (elements) {
          applyingRemoteRef.current = true;
          excalidrawAPI.updateScene({ elements: elements as any });
          applyingRemoteRef.current = false;
        }
      })
      .catch(() => {});
  }, [excalidrawAPI, open, roomId]);

  const handleChange = useCallback(
    (elements: readonly unknown[]) => {
      if (applyingRemoteRef.current) return;

      clearTimeout(broadcastTimeoutRef.current);
      broadcastTimeoutRef.current = setTimeout(() => {
        sendDraw(new TextEncoder().encode(JSON.stringify({ elements })), { reliable: true });
      }, BROADCAST_DEBOUNCE_MS);

      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        api.saveWhiteboard(roomId, { sceneData: { elements } }).catch(() => {});
      }, SAVE_DEBOUNCE_MS);
    },
    [roomId, sendDraw]
  );

  useEffect(
    () => () => {
      clearTimeout(broadcastTimeoutRef.current);
      clearTimeout(saveTimeoutRef.current);
    },
    []
  );

  async function handleClose() {
    try {
      await api.setWhiteboardState(roomId, { open: false });
      setOpen(false);
      sendControl(new TextEncoder().encode("closed"), { reliable: true });
    } catch {
      // le prochain sondage périodique rattrapera l'état si l'appel échoue
    }
  }

  if (!open) return null;

  return (
    <div className="whiteboard-overlay">
      <div className="whiteboard-header">
        <span>Tableau blanc{!canManage && " — lecture seule"}</span>
        {canManage && (
          <button className="icon-btn" onClick={handleClose} title="Fermer pour tout le monde">
            <X size={18} />
          </button>
        )}
      </div>
      <div className="whiteboard-canvas">
        <Excalidraw
          excalidrawAPI={(a) => setExcalidrawAPI(a)}
          onChange={handleChange}
          viewModeEnabled={!canManage}
        />
      </div>
    </div>
  );
}
