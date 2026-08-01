import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw, reconcileElements, CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { useRoomContext } from "@livekit/components-react";
import type { RemoteParticipant } from "livekit-client";
import { RoomEvent } from "livekit-client";
import "@excalidraw/excalidraw/index.css";
import { egressApi } from "../../api/egressApi";

const DRAW_TOPIC = "wb";
const CONTROL_TOPIC = "wb-control";
const POLL_INTERVAL_MS = 4000;
// Filet périodique de rattrapage — voir le même mécanisme, même valeur, dans
// Whiteboard.tsx (côté salle) pour la justification complète. La conséquence
// d'un delta perdu est ICI plus grave que côté salle : ce composant tourne
// dans le navigateur headless de Web Egress, qui PRODUIT L'ENREGISTREMENT —
// un trait manquant dans le rendu de ce composant est un trait manquant dans
// la vidéo pour toujours, aucun "Recadrer" ni fermeture/réouverture manuelle
// ne peut le rattraper après coup.
const RESYNC_INTERVAL_MS = 8000;

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
  const room = useRoomContext();
  const [open, setOpen] = useState(false);
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  // Relue dans l'écouteur stable ci-dessous, jamais mise en dépendance de son
  // effet — voir le commentaire complet de cet effet.
  const excalidrawAPIRef = useRef<ExcalidrawImperativeAPI | null>(null);
  excalidrawAPIRef.current = excalidrawAPI;

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

  // RÉCONCILIE (jamais un remplacement brutal) — voir Whiteboard.tsx pour le
  // scénario de course que ça évite (une réponse loadSnapshot en vol qui
  // écraserait un trait reçu entre-temps par l'écouteur de deltas).
  const loadSnapshot = useCallback(() => {
    if (!excalidrawAPI) return;
    egressApi
      .getWhiteboard(roomId, token)
      .then((snapshot) => {
        const elements = (snapshot.sceneData as { elements?: OrderedExcalidrawElement[] } | null)?.elements;
        if (!elements) return;
        const reconciled = reconcileElements(
          excalidrawAPI.getSceneElements(),
          elements as unknown as RemoteExcalidrawElement[],
          excalidrawAPI.getAppState()
        );
        excalidrawAPI.updateScene({ elements: reconciled, captureUpdate: CaptureUpdateAction.NEVER });
        if (reconciled.length > 0) {
          excalidrawAPI.scrollToContent(reconciled, { fitToContent: true, animate: false });
        }
      })
      .catch(() => {});
  }, [excalidrawAPI, roomId, token]);

  const loadSnapshotRef = useRef(loadSnapshot);
  loadSnapshotRef.current = loadSnapshot;

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

  // Écouteur de données CONSOLIDÉ, seule dépendance `room` (stable pour toute
  // la durée de la capture) — remplace les deux useDataChannel(TOPIC,
  // callbackEnLigne) précédents. Ce hook de @livekit/components-react
  // réabonne room.on(DataReceived) dès que la référence du callback change, et
  // une fonction fléchée déclarée dans le corps du composant en est une
  // NOUVELLE À CHAQUE RENDU — tout delta arrivé pendant la fenêtre de
  // réabonnement était perdu pour de bon (même en `reliable: true`, qui ne
  // protège que le transport, pas la présence d'un auditeur JS au bon
  // moment). Défaut identifié côté salle (voir Whiteboard.tsx pour le détail
  // complet de l'incident et sa correction) — ici la conséquence est pire :
  // un trait manquant dans l'ENREGISTREMENT ne se répare jamais après coup.
  useEffect(() => {
    function handleData(
      payload: Uint8Array,
      participant: RemoteParticipant | undefined,
      _kind: unknown,
      topic: string | undefined
    ) {
      if (topic === CONTROL_TOPIC) {
        refreshState();
        return;
      }
      if (topic !== DRAW_TOPIC) return;

      const excalidrawAPI = excalidrawAPIRef.current;
      if (!excalidrawAPI) return;

      const senderIsModerator = (() => {
        try {
          return participant?.metadata ? JSON.parse(participant.metadata).isModerator === true : false;
        } catch {
          return false;
        }
      })();
      if (!senderIsModerator) return;

      try {
        const { elements } = JSON.parse(new TextDecoder().decode(payload)) as {
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
    }

    room.on(RoomEvent.DataReceived, handleData);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
    };
  }, [room]);

  // Filet périodique, en plus de la garde ci-dessus : couvre un delta isolé
  // perdu alors que la connexion reste apparemment saine (fenêtre de
  // réabonnement d'un composant voisin, perte ponctuelle côté SFU...). Actif
  // en permanence tant que le panneau est ouvert, sans distinction de rôle —
  // ce composant ne diffuse jamais, il n'est jamais "la source de vérité"
  // comme peut l'être un modérateur côté salle.
  useEffect(() => {
    if (!open) return;
    const interval = setInterval(() => loadSnapshotRef.current(), RESYNC_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [open]);

  if (!open) return null;

  return (
    <div className="whiteboard-overlay">
      <div className="whiteboard-canvas">
        <Excalidraw excalidrawAPI={(a) => setExcalidrawAPI(a)} viewModeEnabled zenModeEnabled />
      </div>
    </div>
  );
}
