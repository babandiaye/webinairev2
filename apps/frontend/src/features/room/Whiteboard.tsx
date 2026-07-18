import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Excalidraw, reconcileElements, CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { useDataChannel, useRoomContext } from "@livekit/components-react";
import { RoomEvent } from "livekit-client";
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
  const room = useRoomContext();
  const [open, setOpen] = useState(false);
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  const broadcastTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  // Dernière version connue de chaque élément déjà diffusé — permet de
  // n'envoyer que le delta (élément créé/modifié/supprimé) plutôt que la scène
  // complète à chaque frappe. Sans ça, une scène de quelques dizaines de traits
  // dépasse vite la limite ~15 Kio d'un paquet de données LiveKit fiable, et
  // sendDraw échoue silencieusement (pas de retour d'erreur exploité) — les
  // autres participants restent alors figés sur un état obsolète.
  const lastSentVersionsRef = useRef(new Map<string, number>());
  // Un spectateur (viewModeEnabled) suit par défaut le dessin du modérateur :
  // chaque delta reçu recadre sa caméra pour garder l'ensemble du dessin
  // visible, plutôt que de ne cadrer qu'une seule fois à l'ouverture — sinon,
  // dès que le modérateur étend son dessin au-delà du cadrage initial, une
  // partie part hors champ sur un écran mobile étroit. Jamais utilisé côté
  // modérateur (sa caméra n'est jamais touchée automatiquement).
  const followViewportRef = useRef(true);
  // Consommé par handleScrollChange pour ignorer le changement de caméra causé
  // par NOTRE PROPRE scrollToContent automatique (Correctif 1) — sans ce
  // garde-fou, chaque recadrage automatique se désengagerait lui-même
  // immédiatement, puisqu'onScrollChange se déclenche aussi bien pour un
  // geste utilisateur que pour un scrollToContent programmatique.
  const justFitRef = useRef(false);

  // Seul le modérateur diffuse : les autres sont de toute façon en lecture
  // seule côté UI (viewModeEnabled), mais un client modifié pourrait quand même
  // publier sur ce topic — on l'ignore aussi à la réception (voir plus bas).
  // Ça élimine par la même occasion tout risque d'écho : si jamais un
  // updateScene() distant redéclenchait onChange (React peut différer le
  // re-render qui l'appelle, cf. commentaire sur applyingRemoteRef ci-dessous),
  // un participant qui ne diffuse jamais ne peut pas rebroadcaster ce qu'il reçoit.
  const canBroadcast = canManage;

  const { send: sendDraw } = useDataChannel(DRAW_TOPIC, (msg) => {
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
      // Recadrage continu pour un spectateur qui suit encore le dessin (voir
      // followViewportRef) — jamais pour le modérateur, dont la caméra ne doit
      // jamais être touchée automatiquement pendant qu'il dessine.
      if (!canManage && followViewportRef.current && reconciled.length > 0) {
        justFitRef.current = true;
        excalidrawAPI.scrollToContent(reconciled, { fitToContent: true, animate: false });
      }
    } catch {
      // message malformé ignoré
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

  const loadSnapshot = useCallback(() => {
    if (!excalidrawAPI) return;
    api
      .getWhiteboard(roomId)
      .then((snapshot) => {
        const elements = (snapshot.sceneData as { elements?: OrderedExcalidrawElement[] } | null)?.elements;
        if (elements) {
          excalidrawAPI.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
          lastSentVersionsRef.current = new Map(elements.map((el) => [el.id, el.version]));
          // Sans ça, la caméra (zoom/défilement) de ce client reste à sa position
          // par défaut au chargement — sans rapport avec l'endroit où le dessin
          // existant se trouve réellement sur le canevas infini. Symptôme observé :
          // un participant qui ouvre le tableau blanc en cours de session ne voit
          // qu'un fragment minuscule et décentré de ce que le modérateur a dessiné.
          // Pour le modérateur (qui rejoint une scène existante), toujours cadrer —
          // sa caméra n'est de toute façon jamais recadrée ensuite. Pour un
          // spectateur, seulement s'il suit encore le dessin (followViewportRef) :
          // un resync réseau (RoomEvent.Reconnected) ne doit pas lui arracher la
          // caméra s'il l'avait déjà déplacée avant la coupure.
          if (elements.length > 0 && (canManage || followViewportRef.current)) {
            justFitRef.current = true;
            excalidrawAPI.scrollToContent(elements, { fitToContent: true, animate: false });
          }
        }
      })
      .catch(() => {});
  }, [excalidrawAPI, roomId, canManage]);

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
    loadSnapshot();
  }, [excalidrawAPI, open, loadSnapshot]);

  // Filet de rattrapage après une coupure réseau (changement wifi/4G, mise en
  // veille de l'onglet sur mobile) : la diffusion "reliable" est best-effort,
  // un message manqué pendant la déconnexion ne sera jamais réémis — sans ce
  // resync, le participant reste durablement désynchronisé sans le savoir.
  useEffect(() => {
    if (!open) return;
    room.on(RoomEvent.Reconnected, loadSnapshot);
    return () => {
      room.off(RoomEvent.Reconnected, loadSnapshot);
    };
  }, [room, open, loadSnapshot]);

  // Désactive le pinch-zoom NATIF du navigateur tant que le tableau blanc est
  // ouvert (restauré à la fermeture) — Excalidraw a son propre zoom/pan
  // tactile, et laisser le navigateur zoomer la page EN PLUS désynchronise le
  // viewport visuel de celui utilisé pour placer les traits sur mobile :
  // symptôme observé, un trait apparaît décalé tant qu'on n'a pas pincé pour
  // forcer un recalcul. C'est exactement le réglage qu'utilise excalidraw.com
  // lui-même (meta viewport avec maximum-scale=1,user-scalable=no).
  useEffect(() => {
    if (!open) return;
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    const original = meta.getAttribute("content");
    if (original) meta.setAttribute("content", `${original}, maximum-scale=1, user-scalable=no`);
    return () => {
      if (original) meta.setAttribute("content", original);
    };
  }, [open]);

  // Débraye le suivi de caméra (Correctif 1) dès que LE SPECTATEUR déplace
  // lui-même la caméra (pan/pinch-zoom pour inspecter un détail) — sinon le
  // prochain trait reçu la lui arracherait aussitôt. onScrollChange se
  // déclenche pour tout changement de caméra, y compris ceux causés par nos
  // propres scrollToContent automatiques : justFitRef distingue les deux et
  // n'écarte que ce cas-là (voir sa déclaration plus haut).
  const handleScrollChange = useCallback(() => {
    if (canManage) return;
    if (justFitRef.current) {
      justFitRef.current = false;
      return;
    }
    followViewportRef.current = false;
  }, [canManage]);

  const handleChange = useCallback(
    (elements: readonly OrderedExcalidrawElement[]) => {
      if (!canBroadcast) return;

      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        api.saveWhiteboard(roomId, { sceneData: { elements } }).catch(() => {});
      }, SAVE_DEBOUNCE_MS);

      clearTimeout(broadcastTimeoutRef.current);
      broadcastTimeoutRef.current = setTimeout(() => {
        // Delta uniquement : élément absent de lastSentVersionsRef (nouveau) ou
        // dont la version a changé (modifié/déplacé/supprimé — une suppression
        // est un passage isDeleted:true qui incrémente aussi version).
        const changed = elements.filter((el) => lastSentVersionsRef.current.get(el.id) !== el.version);
        if (changed.length === 0) return;
        for (const el of changed) lastSentVersionsRef.current.set(el.id, el.version);

        sendDraw(new TextEncoder().encode(JSON.stringify({ elements: changed })), { reliable: true }).catch(
          (e: unknown) => {
            // Le message le plus probable : paquet > limite du data channel
            // LiveKit — les autres participants resteront désynchronisés tant
            // que ce n'est pas visible. Loggé plutôt qu'avalé silencieusement.
            console.warn("Diffusion du tableau blanc échouée", e);
          }
        );
      }, BROADCAST_DEBOUNCE_MS);
    },
    [roomId, sendDraw, canBroadcast]
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
          onScrollChange={handleScrollChange}
          // Réduit le menu (utile surtout sur l'UI mobile d'Excalidraw, plus
          // contrainte en place) et retire des actions inadaptées à une scène
          // partagée en direct : loadScene écraserait le dessin de tout le
          // monde avec un fichier local sans repasser par la synchronisation,
          // export/saveToActiveFile n'ont pas de sens ici (rien à exporter
          // vers un fichier local pour une session collaborative éphémère).
          UIOptions={{
            canvasActions: {
              loadScene: false,
              export: false,
              saveToActiveFile: false,
              toggleTheme: null,
            },
          }}
        />
      </div>
    </div>
  );
}
