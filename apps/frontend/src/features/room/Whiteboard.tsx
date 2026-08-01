import { useCallback, useEffect, useRef, useState } from "react";
import { Focus, X } from "lucide-react";
import { Excalidraw, reconcileElements, CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { useRoomContext } from "@livekit/components-react";
import type { RemoteParticipant } from "livekit-client";
import { RoomEvent } from "livekit-client";
import "@excalidraw/excalidraw/index.css";
import { api } from "../../api/client";

const DRAW_TOPIC = "wb";
const CONTROL_TOPIC = "wb-control";
// CADENCE MAXIMALE de diffusion, et non un simple debounce : Excalidraw émet
// onChange à CHAQUE mouvement du pointeur, donc un debounce pur (clearTimeout
// systématique) ne se déclenchait jamais tant que le tracé continuait — le
// participant ne voyait le trait qu'à la première pause de l'enseignant, d'où
// les "quelques secondes" de retard observées sur un mot écrit d'un seul geste.
// On garantit désormais au plus UN envoi toutes les 300 ms, mais aussi AU MOINS
// un envoi toutes les 300 ms tant que le dessin bouge.
const BROADCAST_INTERVAL_MS = 300;
// Sauvegarde serveur : debounce (on attend le repos, inutile de solliciter
// l'API à chaque trait) MAIS plafonné par SAVE_MAX_WAIT_MS, pour la même
// raison — sans plafond, un tracé continu d'une minute ne sauvegardait rien,
// et un participant qui ouvre le tableau à cet instant recevait un instantané
// vieux d'une minute.
const SAVE_DEBOUNCE_MS = 3000;
const SAVE_MAX_WAIT_MS = 10000;
const POLL_INTERVAL_MS = 4000;
// Filet de rattrapage périodique pour un SPECTATEUR (jamais le modérateur, qui
// est la source de vérité de son propre trait) : recharge l'instantané serveur
// et le RÉCONCILIE (jamais un remplacement brutal) avec la scène locale. Sans
// ce filet, un seul delta perdu — coupure de quelques centaines de ms, paquet
// arrivé pendant une brève réabonnement — désynchronise le spectateur jusqu'à
// ce qu'il ferme et rouvre le panneau. 8 s : assez court pour une réparation
// perçue comme immédiate, assez long pour ne pas doubler la charge du sondage
// d'état déjà en place (POLL_INTERVAL_MS, actif même panneau fermé).
const RESYNC_INTERVAL_MS = 8000;

// Session partagée : ouverte/fermée pour tout le monde à la fois, pas un simple
// panneau d'affichage local — sinon les autres participants ne voient jamais le
// tableau blanc apparaître quand quelqu'un l'ouvre de son côté.
export function Whiteboard({ roomId, canManage }: { roomId: string; canManage: boolean }) {
  const room = useRoomContext();
  const [open, setOpen] = useState(false);
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  // Affiché à l'animateur seul : si l'instantané ne part plus, lui continue de
  // voir son dessin normalement — ce sont les participants qui rejoindront
  // ensuite qui hériteront d'un tableau incomplet. Sans ce signal, la panne est
  // strictement invisible du côté de la seule personne qui peut réagir.
  const [saveFailed, setSaveFailed] = useState(false);
  const broadcastTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  // Dernière version connue de chaque élément déjà diffusé — permet de
  // n'envoyer que le delta (élément créé/modifié/supprimé) plutôt que la scène
  // complète à chaque frappe. Sans ça, une scène de quelques dizaines de traits
  // dépasse vite la limite ~15 Kio d'un paquet de données LiveKit fiable, et
  // l'envoi échoue (voir le .catch de publishData plus bas, qui journalise
  // mais ne remonte rien à l'écran) — les autres participants restent alors
  // figés sur un état obsolète.
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
  // geste utilisateur que pour un scrollToContent programmatique. Fenêtre
  // temporelle plutôt que flag consommé une seule fois : handleRecenter
  // recadre avec animate:true, dont l'animation déclenche onScrollChange à
  // chaque frame — un flag à usage unique laisserait les frames suivantes
  // débrayer le suivi qu'on vient tout juste de réengager.
  const suppressDisengageUntilRef = useRef(0);

  // Seul le modérateur diffuse : les autres sont de toute façon en lecture
  // seule côté UI (viewModeEnabled), mais un client modifié pourrait quand même
  // publier sur ce topic — on l'ignore aussi à la réception (voir plus bas).
  // Ça élimine par la même occasion tout risque d'écho : si jamais un
  // updateScene() distant redéclenchait onChange (React peut différer le
  // re-render qui l'appelle, cf. commentaire sur applyingRemoteRef ci-dessous),
  // un participant qui ne diffuse jamais ne peut pas rebroadcaster ce qu'il reçoit.
  const canBroadcast = canManage;

  // Refs relues DANS l'écouteur ci-dessous, jamais mises en dépendance de son
  // effet — voir le commentaire complet sur cet effet pour l'incident que ça
  // corrige (désabonnement/réabonnement du canal de données à chaque rendu,
  // et tout paquet arrivé pendant la fenêtre de coupure perdu pour de bon,
  // useDataChannel de @livekit/components-react réabonnant dès que la
  // fonction "onMessage" change de référence — le cas ici à CHAQUE rendu,
  // puisque les deux callbacks étaient déclarés en ligne).
  const excalidrawAPIRef = useRef<ExcalidrawImperativeAPI | null>(null);
  excalidrawAPIRef.current = excalidrawAPI;
  const canManageRef = useRef(canManage);
  canManageRef.current = canManage;

  function refreshState() {
    api.getWhiteboardState(roomId).then((s) => setOpen(s.open)).catch(() => {});
  }

  useEffect(() => {
    refreshState();
    const interval = setInterval(refreshState, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [roomId]);

  // RÉCONCILIE (jamais un remplacement brutal) l'instantané serveur avec la
  // scène locale, au lieu d'un simple updateScene() qui écraserait tout. Ce
  // n'est pas qu'une prudence théorique : un spectateur qui vient d'ouvrir le
  // panneau a une requête loadSnapshot() EN VOL pendant que l'écouteur de
  // deltas (déjà actif, lui, dès le montage) peut très bien recevoir un trait
  // frais entre-temps — sans réconciliation, la réponse (plus lente, donc plus
  // tardive à atterrir) écraserait ce trait tout juste reçu. reconcileElements
  // compare les numéros de version et garde toujours le plus récent des deux
  // côtés, quel que soit l'ordre d'arrivée — la même fonction qui protège déjà
  // la réception normale des deltas protège donc aussi ce chemin.
  const loadSnapshot = useCallback(() => {
    if (!excalidrawAPI) return;
    api
      .getWhiteboard(roomId)
      .then((snapshot) => {
        const elements = (snapshot.sceneData as { elements?: OrderedExcalidrawElement[] } | null)?.elements;
        if (!elements) return;

        const reconciled = reconcileElements(
          excalidrawAPI.getSceneElements(),
          elements as unknown as RemoteExcalidrawElement[],
          excalidrawAPI.getAppState()
        );
        excalidrawAPI.updateScene({ elements: reconciled, captureUpdate: CaptureUpdateAction.NEVER });
        lastSentVersionsRef.current = new Map(reconciled.map((el) => [el.id, el.version]));
        // Sans ça, la caméra (zoom/défilement) de ce client reste à sa position
        // par défaut au chargement — sans rapport avec l'endroit où le dessin
        // existant se trouve réellement sur le canevas infini. Symptôme observé :
        // un participant qui ouvre le tableau blanc en cours de session ne voit
        // qu'un fragment minuscule et décentré de ce que le modérateur a dessiné.
        // Pour le modérateur (qui rejoint une scène existante), toujours cadrer —
        // sa caméra n'est de toute façon jamais recadrée ensuite. Pour un
        // spectateur, seulement s'il suit encore le dessin (followViewportRef) :
        // un resync (reconnexion réseau, ou filet périodique) ne doit pas lui
        // arracher la caméra s'il l'avait déjà déplacée lui-même auparavant.
        if (reconciled.length > 0 && (canManage || followViewportRef.current)) {
          suppressDisengageUntilRef.current = Date.now() + 800;
          excalidrawAPI.scrollToContent(reconciled, { fitToContent: true, animate: false });
        }
      })
      .catch(() => {});
  }, [excalidrawAPI, roomId, canManage]);

  // Relu dans les écouteurs stables ci-dessous sans jamais les faire dépendre
  // de loadSnapshot (dont l'identité change avec excalidrawAPI/canManage) —
  // même raison que pour excalidrawAPIRef plus haut.
  const loadSnapshotRef = useRef(loadSnapshot);
  loadSnapshotRef.current = loadSnapshot;

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

  // Écouteurs de données de la salle, CONSOLIDÉS en un seul abonnement dont la
  // seule dépendance est `room` — un objet stable pour toute la durée de
  // connexion (voir useRoomSignals.ts, même patron). C'est le correctif de
  // l'instabilité rapportée ("le tableau blanc ne s'affiche plus côté
  // participant") : useDataChannel(TOPIC, callbackEnLigne) de
  // @livekit/components-react réabonne room.on(DataReceived) dès que la
  // référence du callback change — et une fonction fléchée déclarée dans le
  // corps du composant est UNE NOUVELLE référence à CHAQUE rendu. RoomPage
  // porte beaucoup d'état (panneaux, micro coupé, etc.) qui redessine ses
  // enfants souvent ; chaque rendu débranchait puis rebranchait l'écouteur, et
  // tout trait arrivé pendant cette fenêtre (même envoyé en `reliable: true`,
  // qui ne protège que le TRANSPORT, pas la présence d'un auditeur JS au bon
  // moment) était perdu pour de bon — d'où un tableau blanc "parfois" vide,
  // jamais franchement cassé, exactement le symptôme observé.
  // RoomEvent.Reconnected est regroupé ici pour la même raison : il dépendait
  // jusqu'ici de loadSnapshot, dont l'identité change avec excalidrawAPI/
  // canManage — un point de churn supplémentaire, moindre mais de même nature.
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
        // Recadrage continu pour un spectateur qui suit encore le dessin (voir
        // followViewportRef) — jamais pour le modérateur, dont la caméra ne
        // doit jamais être touchée automatiquement pendant qu'il dessine.
        if (!canManageRef.current && followViewportRef.current && reconciled.length > 0) {
          suppressDisengageUntilRef.current = Date.now() + 800;
          excalidrawAPI.scrollToContent(reconciled, { fitToContent: true, animate: false });
        }
      } catch {
        // message malformé ignoré
      }
    }

    // Filet de rattrapage après une coupure réseau (changement wifi/4G, mise
    // en veille de l'onglet sur mobile) : la diffusion "reliable" retransmet
    // au niveau transport mais ne survit pas à une reconnexion complète — un
    // message émis pendant que ce client était injoignable ne sera jamais
    // réémis, d'où ce resync explicite sur le retour de connexion.
    function handleReconnected() {
      loadSnapshotRef.current();
    }

    room.on(RoomEvent.DataReceived, handleData);
    room.on(RoomEvent.Reconnected, handleReconnected);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
      room.off(RoomEvent.Reconnected, handleReconnected);
    };
  }, [room]);

  // Filet PÉRIODIQUE, en plus de la reconnexion ci-dessus : celle-ci ne
  // couvre qu'une coupure réseau franche (RoomEvent.Reconnected), pas un
  // delta isolé perdu alors que la connexion reste apparemment saine (fenêtre
  // de réabonnement d'un composant voisin, perte ponctuelle côté SFU...). Un
  // spectateur ainsi désynchronisé n'a aujourd'hui aucun moyen de le savoir —
  // ce filet le répare de lui-même en quelques secondes, sans action de sa
  // part. Jamais pour le modérateur : sa scène locale EST la vérité qu'il
  // diffuse, un resync purement décoratif ne ferait qu'ajouter de la charge
  // sans rien réparer.
  useEffect(() => {
    if (!open || canManage) return;
    const interval = setInterval(() => loadSnapshotRef.current(), RESYNC_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [open, canManage]);

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
  // propres scrollToContent automatiques : suppressDisengageUntilRef distingue
  // les deux et n'écarte que ce cas-là (voir sa déclaration plus haut).
  const handleScrollChange = useCallback(() => {
    if (canManage) return;
    if (Date.now() < suppressDisengageUntilRef.current) return;
    followViewportRef.current = false;
  }, [canManage]);

  // Toujours la scène la PLUS RÉCENTE au moment où le minuteur se déclenche :
  // entre la planification et l'envoi, d'autres onChange sont arrivés, et
  // diffuser la scène capturée à la planification perdrait ces traits-là.
  const pendingElementsRef = useRef<readonly OrderedExcalidrawElement[]>([]);
  // 0 volontairement : le tout premier trait part immédiatement, sans attendre
  // l'intervalle — c'est le moment où la latence perçue compte le plus.
  const lastBroadcastAtRef = useRef(0);
  // Date.now() au contraire de ci-dessus : à 0, le plafond SAVE_MAX_WAIT_MS
  // serait déjà dépassé au montage et le premier onChange (Excalidraw en émet
  // un au chargement de la scène) déclencherait une sauvegarde immédiate,
  // court-circuitant le debounce qu'on veut justement conserver ici.
  const lastSaveAtRef = useRef(Date.now());

  const flushBroadcast = useCallback(() => {
    broadcastTimeoutRef.current = undefined;
    lastBroadcastAtRef.current = Date.now();

    // Delta uniquement : élément absent de lastSentVersionsRef (nouveau) ou
    // dont la version a changé (modifié/déplacé/supprimé — une suppression
    // est un passage isDeleted:true qui incrémente aussi version).
    const changed = pendingElementsRef.current.filter(
      (el) => lastSentVersionsRef.current.get(el.id) !== el.version
    );
    if (changed.length === 0) return;
    for (const el of changed) lastSentVersionsRef.current.set(el.id, el.version);

    // Envoi direct via room.localParticipant plutôt que le `send` fourni
    // par useDataChannel — supprimé avec le hook lui-même (voir l'effet
    // d'abonnement consolidé plus haut) : aucune raison de le réintroduire
    // seulement pour l'émission, `room` étant de toute façon déjà stable.
    room.localParticipant
      .publishData(new TextEncoder().encode(JSON.stringify({ elements: changed })), {
        reliable: true,
        topic: DRAW_TOPIC,
      })
      .catch((e: unknown) => {
        // Le message le plus probable : paquet > limite du data channel
        // LiveKit — les autres participants resteront désynchronisés tant
        // que ce n'est pas visible. Loggé plutôt qu'avalé silencieusement.
        console.warn("Diffusion du tableau blanc échouée", e);
      });
  }, [room]);

  const flushSave = useCallback(() => {
    saveTimeoutRef.current = undefined;
    lastSaveAtRef.current = Date.now();
    api
      .saveWhiteboard(roomId, { sceneData: { elements: pendingElementsRef.current } })
      .then(() => setSaveFailed(false))
      .catch((e: unknown) => {
        // Ne JAMAIS avaler cet échec en silence : un .catch(() => {}) a masqué
        // pendant des semaines un 413 systématique (limite de corps Express à
        // 100 Ko, dépassée dès ~35 traits) qui figeait l'instantané serveur pour
        // le reste de la séance. Conséquence invisible pour l'animateur, qui
        // continuait de dessiner normalement, mais bien réelle pour quiconque
        // rejoignait ensuite : un tableau blanc incomplet.
        console.warn("Sauvegarde du tableau blanc échouée", e);
        setSaveFailed(true);
      });
  }, [roomId]);

  const handleChange = useCallback(
    (elements: readonly OrderedExcalidrawElement[]) => {
      if (!canBroadcast) return;
      pendingElementsRef.current = elements;
      const now = Date.now();

      // Diffusion à cadence garantie (voir BROADCAST_INTERVAL_MS) : envoi
      // immédiat si le dernier remonte à plus de l'intervalle, sinon on
      // planifie POUR LE SOLDE du temps restant — et surtout on ne replanifie
      // pas si un envoi est déjà en attente, ce qui est précisément ce qui
      // repoussait indéfiniment l'échéance avec l'ancien debounce.
      const sinceBroadcast = now - lastBroadcastAtRef.current;
      if (sinceBroadcast >= BROADCAST_INTERVAL_MS) {
        clearTimeout(broadcastTimeoutRef.current);
        flushBroadcast();
      } else if (broadcastTimeoutRef.current === undefined) {
        broadcastTimeoutRef.current = setTimeout(
          flushBroadcast,
          BROADCAST_INTERVAL_MS - sinceBroadcast
        );
      }

      // Sauvegarde : debounce classique (attendre le repos), mais l'échéance
      // ne peut jamais être repoussée au-delà de SAVE_MAX_WAIT_MS depuis la
      // dernière sauvegarde effective.
      const remainingBeforeForcedSave = SAVE_MAX_WAIT_MS - (now - lastSaveAtRef.current);
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(
        flushSave,
        Math.max(0, Math.min(SAVE_DEBOUNCE_MS, remainingBeforeForcedSave))
      );
    },
    [canBroadcast, flushBroadcast, flushSave]
  );

  useEffect(
    () => () => {
      clearTimeout(broadcastTimeoutRef.current);
      clearTimeout(saveTimeoutRef.current);
    },
    []
  );

  // Réengage le suivi automatique (Correctif 2 l'a désengagé) et recadre
  // immédiatement sur l'état actuel du dessin — seul moyen pour un spectateur
  // de revenir à une vue complète après avoir pan/zoomé lui-même.
  function handleRecenter() {
    if (!excalidrawAPI) return;
    followViewportRef.current = true;
    suppressDisengageUntilRef.current = Date.now() + 800;
    excalidrawAPI.scrollToContent(excalidrawAPI.getSceneElements(), { fitToContent: true, animate: true });
  }

  async function handleClose() {
    try {
      await api.setWhiteboardState(roomId, { open: false });
      setOpen(false);
      room.localParticipant.publishData(new TextEncoder().encode("closed"), {
        reliable: true,
        topic: CONTROL_TOPIC,
      });
    } catch {
      // le prochain sondage périodique rattrapera l'état si l'appel échoue
    }
  }

  if (!open) return null;

  return (
    <div className="whiteboard-overlay">
      <div className="whiteboard-header">
        <span>Tableau blanc{!canManage && " — lecture seule"}</span>
        {canManage && saveFailed && (
          <span className="whiteboard-save-warning" title="Le dessin reste visible en direct, mais un participant qui rejoint maintenant ne le recevra pas en entier.">
            Sauvegarde interrompue
          </span>
        )}
        {!canManage && (
          <button className="icon-btn" onClick={handleRecenter} title="Recadrer sur le dessin">
            <Focus size={18} />
          </button>
        )}
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
