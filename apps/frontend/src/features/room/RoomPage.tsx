import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  useRoomContext,
} from "@livekit/components-react";
import { X } from "lucide-react";
import "@livekit/components-styles";
import { JoinRoomResponseDto } from "@webinairev2/shared-types";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { CallTopBar } from "./CallTopBar";
import { CallSidebar, SidebarTab } from "./CallSidebar";
import { CallStage } from "./CallStage";
import { CallControlBar } from "./CallControlBar";
import { CallSideNav, CallPanel } from "./CallSideNav";
import { CallSettingsModal } from "./CallSettingsModal";
import { EchoWarningBanner } from "./EchoWarningBanner";
import { PreJoinScreen, DeviceSelection } from "./PreJoinScreen";
import { EngagementProvider } from "./useEngagementStats";
import { EngagementPanel } from "./EngagementPanel";
import { RoomSignalsProvider } from "./useRoomSignals";
import { ReactionsOverlay } from "./ReactionsOverlay";
import { BreakoutManagePanel } from "./BreakoutManagePanel";
import { BreakoutAssignedBanner } from "./BreakoutAssignedBanner";
import { BreakoutReturnBar } from "./BreakoutReturnBar";
import { Whiteboard } from "./Whiteboard";
import { PollsPanel } from "./PollsPanel";
import { PresentationsPanel } from "./PresentationsPanel";

// Doit correspondre exactement au message de RoomsService.join() côté backend —
// c'est ce qui distingue une vraie erreur (salle introuvable, etc.) d'une simple
// attente qui se résout d'elle-même dès qu'un modérateur rejoint.
const WAITING_FOR_MODERATOR_MESSAGE = "La réunion n'a pas encore commencé, en attente d'un modérateur";
const RETRY_DELAY_MS = 5000;
const SPEAKER_MUTED_KEY = "webinairev2.speakerMuted";

// Le choix de sortie audio ne passe pas par le token ni par les options de
// connexion : il s'applique à la salle une fois connectée (switchActiveDevice).
// Composant plutôt qu'effet dans RoomPage : useRoomContext n'existe qu'à
// l'intérieur de <LiveKitRoom>.
function ApplyAudioOutput({ deviceId }: { deviceId?: string }) {
  const room = useRoomContext();
  useEffect(() => {
    if (!deviceId) return;
    // Échec sans gravité : navigateur sans setSinkId, ou périphérique débranché
    // entre l'écran de pré-connexion et l'entrée en salle — le son sort alors
    // sur la sortie par défaut du système.
    room.switchActiveDevice("audiooutput", deviceId).catch(() => {});
  }, [room, deviceId]);
  return null;
}

export function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [mainConnection, setMainConnection] = useState<JoinRoomResponseDto | null>(null);
  const [activeConnection, setActiveConnection] = useState<JoinRoomResponseDto | null>(null);
  const [activePanel, setActivePanel] = useState<CallPanel | null>(null);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("participants");
  // Panneaux latéraux mobiles (voir CallSideNav/CallSidebar) — sans effet sur
  // desktop où ils restent des colonnes en permanence visibles (CSS uniquement,
  // le breakpoint mobile est ce qui donne un sens à ces états). Un seul ouvert
  // à la fois : ouvrir l'un referme l'autre plutôt que de les empiler.
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileSideNavOpen, setMobileSideNavOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Couper SES PROPRES haut-parleurs : seul vrai remède quand deux appareils
  // sont dans la même pièce (l'annulation d'écho du navigateur ne peut rien
  // contre le haut-parleur du voisin — voir useEchoDetection). Persisté par
  // appareil : celui qui est en salle avec d'autres le reste d'un cours à
  // l'autre, sans avoir à y repenser.
  const [speakerMuted, setSpeakerMuted] = useState(
    () => localStorage.getItem(SPEAKER_MUTED_KEY) === "1"
  );
  // Deux états distincts : `error` est FATAL (échec de la connexion initiale —
  // remplace toute la page), `actionError` signale l'échec d'une action pendant
  // l'appel (rejoindre un sous-groupe, ouvrir le tableau blanc) et s'affiche en
  // bandeau temporaire. Les confondre déconnectait l'utilisateur de l'appel en
  // cours pour une simple action ratée, sans aucun retour possible.
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [waitingForModerator, setWaitingForModerator] = useState(false);
  // null tant que l'écran de pré-connexion n'a pas été validé. Une fois rempli,
  // il ne repasse jamais à null : changer de salle (principale ↔ sous-groupe) ne
  // doit pas redemander de revérifier son matériel en plein cours.
  const [deviceSelection, setDeviceSelection] = useState<DeviceSelection | null>(null);
  // Distingue un vrai départ (bouton "quitter", → retour à l'accueil) d'un
  // changement de salle déclenché par nous (breakout ↔ principale, → on ne doit
  // surtout pas rediriger l'utilisateur hors de l'appli dans ce cas).
  const switchingRef = useRef(false);

  useEffect(() => {
    localStorage.setItem(SPEAKER_MUTED_KEY, speakerMuted ? "1" : "0");
  }, [speakerMuted]);


  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let retryTimeout: ReturnType<typeof setTimeout>;

    function attempt() {
      api
        .joinRoom(id!)
        .then((conn) => {
          if (cancelled) return;
          setWaitingForModerator(false);
          setMainConnection(conn);
          setActiveConnection(conn);
        })
        .catch((e) => {
          if (cancelled) return;
          const message = e instanceof Error ? e.message : "Erreur inconnue";
          if (message === WAITING_FOR_MODERATOR_MESSAGE) {
            setWaitingForModerator(true);
            retryTimeout = setTimeout(attempt, RETRY_DELAY_MS);
          } else {
            setError(message);
          }
        });
    }

    attempt();
    return () => {
      cancelled = true;
      clearTimeout(retryTimeout);
    };
  }, [id]);

  if (error) {
    return (
      <div className="loading-screen">
        <div className="error-banner">{error}</div>
      </div>
    );
  }
  if (waitingForModerator) {
    return (
      <div className="loading-screen">
        <div className="waiting-moderator">
          <div className="spinner" />
          <p>En attente d'un modérateur pour démarrer la réunion…</p>
        </div>
      </div>
    );
  }
  if (!activeConnection || !id || !user) return <div className="loading-screen">Connexion à la salle…</div>;

  // room.canManage est calculé côté serveur (créateur, admin, ou co-modérateur
  // inscrit — voir EnrollmentsService.canManageRoom) : le recalculer localement
  // à partir de creatorId seul (ancien code) ignorait à tort les co-modérateurs.
  const canManage = activeConnection.room.canManage;
  const isInBreakout = activeConnection.room.type === "BREAKOUT";

  // Vérification du matériel avant d'entrer : découvrir en plein cours que son
  // micro capte le haut-parleur du voisin coûte l'attention de toute la classe.
  if (!deviceSelection) {
    return (
      <PreJoinScreen
        room={activeConnection.room}
        canManage={canManage}
        onJoin={setDeviceSelection}
      />
    );
  }

  async function handleJoinBreakout(breakoutId: string) {
    if (!id) return;
    try {
      const conn = await api.joinBreakoutRoom(id, breakoutId);
      switchingRef.current = true;
      setActiveConnection(conn);
      setActivePanel(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Erreur inconnue");
    }
  }

  function handleReturnToMain() {
    if (!mainConnection) return;
    switchingRef.current = true;
    setActiveConnection(mainConnection);
  }

  function handleSelectPanel(panel: CallPanel) {
    setMobileSideNavOpen(false);
    if (panel === "whiteboard") {
      // Le tableau blanc est une session partagée (ouverte pour tout le monde),
      // pas un panneau d'affichage local — voir Whiteboard.tsx.
      api.setWhiteboardState(activeConnection!.room.id, { open: true }).catch((e) => {
        setActionError(e instanceof Error ? e.message : "Erreur inconnue");
      });
      return;
    }
    setActivePanel(panel);
  }

  return (
    <LiveKitRoom
      key={activeConnection.room.id}
      className="room-page"
      data-lk-theme="default"
      serverUrl={activeConnection.livekitUrl}
      token={activeConnection.token}
      connect
      // Un participant démarre sans droit de publication (canPublish=false côté
      // token — voir livekit-token.service.ts) et ne peut l'obtenir qu'en cours de
      // session via setSpeakerPermission ; lui demander caméra/micro dès la
      // connexion ne ferait qu'afficher une invite navigateur inutile (et
      // échouerait côté SFU de toute façon). Un modérateur, lui, publie toujours
      // dès l'entrée.
      video={canManage}
      audio={canManage}
      // adaptiveStream/dynacast désactivés par défaut dans le SDK : sans eux,
      // chaque piste vidéo est reçue/forwardée à sa couche simulcast la plus
      // haute même pour une vignette minuscule ou masquée — négligeable à
      // quelques participants, mais ça multiplie directement la bande passante
      // d'egress par le nombre de spectateurs sur une salle à grande échelle
      // (voir docs.livekit.io/home/client/tracks/subscribe).
      // audioCaptureDefaults épinglés explicitement : ce sont déjà les valeurs
      // par défaut de livekit-client 2.20 (vérifié dans le bundle), mais ces
      // traitements sont la première ligne de défense contre le bruit et l'écho
      // — les laisser implicites, c'est accepter qu'une future version du SDK
      // les change sans que rien ne le signale ici. Attention : echoCancellation
      // ne neutralise QUE le retour du haut-parleur de CET appareil ; deux
      // appareils voisins relèvent de EchoWarningBanner/speakerMuted.
      // deviceId : reprend le micro/la caméra validés à l'écran de pré-connexion,
      // sinon LiveKit reprendrait le périphérique "par défaut" du système — qui
      // n'est justement pas celui qu'on vient de tester.
      options={{
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {
          ...(deviceSelection.audioinput ? { deviceId: deviceSelection.audioinput } : {}),
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          voiceIsolation: true,
        },
        ...(deviceSelection.videoinput
          ? { videoCaptureDefaults: { deviceId: deviceSelection.videoinput } }
          : {}),
      }}
      // autoSubscribe désactivé pour un spectateur : sur une salle à grande
      // échelle, s'abonner automatiquement à TOUTES les pistes publiées
      // (modérateur + chaque orateur secondaire) coûte cette bande passante
      // ×(nombre de spectateurs). CallStage se charge de l'abonnement manuel
      // à la seule piste principale pour ce rôle (voir son commentaire).
      // Le modérateur, lui, garde l'auto-abonnement : il doit voir la grille
      // complète et son nombre ne se multiplie jamais.
      connectOptions={{ autoSubscribe: canManage }}
      onDisconnected={() => {
        if (switchingRef.current) {
          switchingRef.current = false;
          return;
        }
        // Séance lancée depuis Moodle : on rend la main à la page de l'activité
        // d'où l'utilisateur est parti, au lieu de le laisser sur l'accueil de
        // webinairev2 sans chemin de retour vers son cours.
        // La valeur vient de la SALLE (mainConnection, pas activeConnection :
        // en sous-groupe cette dernière désigne une autre Room), transmise
        // serveur-à-serveur par le plugin — jamais lue dans la barre d'adresse,
        // donc pas de redirection ouverte à filtrer ici.
        // `replace` et non `href` : le bouton Précédent ne doit pas renvoyer
        // dans une salle qu'on vient de quitter.
        const returnUrl = mainConnection?.returnUrl;
        if (returnUrl) {
          window.location.replace(returnUrl);
          return;
        }
        navigate("/");
      }}
    >
      {/* Enveloppe tout le contenu de la salle : la collecte doit démarrer à
          l'entrée en séance, pas à l'ouverture du panneau — sinon un animateur
          qui le consulte à la 40e minute ne verrait rien des 40 premières.
          Ne provoque aucun rendu de ses enfants (voir useEngagementStats). */}
      <EngagementProvider enabled={canManage}>
      <RoomSignalsProvider localIdentity={user.id} room={activeConnection.room}>
      <CallSideNav
        canManage={canManage}
        isInBreakout={isInBreakout}
        activePanel={activePanel}
        onSelect={handleSelectPanel}
        onOpenSettings={() => setSettingsOpen(true)}
        mobileOpen={mobileSideNavOpen}
        onCloseMobile={() => setMobileSideNavOpen(false)}
      />
      <CallSidebar
        roomId={activeConnection.room.id}
        localIdentity={user.id}
        canManage={canManage && !isInBreakout}
        tab={sidebarTab}
        onTabChange={setSidebarTab}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />

      <div className="call-main">
        <CallTopBar
          roomId={activeConnection.room.id}
          title={activeConnection.room.title}
          canManage={canManage && !isInBreakout}
        />

        <div className="call-stage-wrapper">
          <CallStage canManage={canManage} />

          <ReactionsOverlay />

          <EchoWarningBanner speakerMuted={speakerMuted} onMuteSpeakers={() => setSpeakerMuted(true)} />

          {actionError && (
            <div className="call-action-error">
              <span>{actionError}</span>
              <button onClick={() => setActionError(null)} aria-label="Fermer">
                <X size={15} />
              </button>
            </div>
          )}

          {isInBreakout && (
            <BreakoutReturnBar title={activeConnection.room.title} onReturn={handleReturnToMain} />
          )}
          <BreakoutAssignedBanner
            roomId={id}
            currentBreakoutId={isInBreakout ? activeConnection.room.id : null}
            onJoin={handleJoinBreakout}
          />

          <Whiteboard roomId={activeConnection.room.id} canManage={canManage} />
          {!isInBreakout && (
            <BreakoutManagePanel
              roomId={id}
              open={activePanel === "breakout"}
              onClose={() => setActivePanel(null)}
              onJoin={handleJoinBreakout}
            />
          )}
          <PollsPanel
            roomId={activeConnection.room.id}
            canManage={canManage}
            open={activePanel === "polls"}
            onClose={() => setActivePanel(null)}
          />
          <PresentationsPanel
            roomId={activeConnection.room.id}
            canManage={canManage}
            open={activePanel === "presentations"}
            onClose={() => setActivePanel(null)}
          />
          {canManage && (
            <EngagementPanel
              open={activePanel === "engagement"}
              onClose={() => setActivePanel(null)}
              roomTitle={activeConnection.room.title}
            />
          )}
        </div>

        <div className="call-controlbar-wrapper">
          <CallControlBar
            roomId={activeConnection.room.id}
            canManage={canManage && !isInBreakout}
            speakerMuted={speakerMuted}
            onToggleSpeaker={() => setSpeakerMuted((v) => !v)}
            onOpenChat={() => {
              setSidebarTab("chat");
              setMobileSidebarOpen(true);
              setMobileSideNavOpen(false);
            }}
            onOpenParticipants={() => {
              setSidebarTab("participants");
              setMobileSidebarOpen(true);
              setMobileSideNavOpen(false);
            }}
            onOpenMore={() => {
              setMobileSideNavOpen(true);
              setMobileSidebarOpen(false);
            }}
          />
        </div>
      </div>

      <CallSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        roomId={activeConnection.room.id}
        canManage={canManage && !isInBreakout}
        room={activeConnection.room}
        onRoomUpdate={(room) => setActiveConnection((prev) => (prev ? { ...prev, room } : prev))}
      />

      <ApplyAudioOutput deviceId={deviceSelection.audiooutput} />
      <RoomAudioRenderer muted={speakerMuted} />
      <StartAudio label="Cliquer pour activer le son" />
      </RoomSignalsProvider>
      </EngagementProvider>
    </LiveKitRoom>
  );
}
