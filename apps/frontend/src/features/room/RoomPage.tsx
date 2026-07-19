import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LiveKitRoom, RoomAudioRenderer, StartAudio } from "@livekit/components-react";
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
  const [error, setError] = useState<string | null>(null);
  const [waitingForModerator, setWaitingForModerator] = useState(false);
  // Distingue un vrai départ (bouton "quitter", → retour à l'accueil) d'un
  // changement de salle déclenché par nous (breakout ↔ principale, → on ne doit
  // surtout pas rediriger l'utilisateur hors de l'appli dans ce cas).
  const switchingRef = useRef(false);

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

  const canManage = user.role === "ADMIN" || user.id === activeConnection.room.creatorId;
  const isInBreakout = activeConnection.room.type === "BREAKOUT";

  async function handleJoinBreakout(breakoutId: string) {
    if (!id) return;
    try {
      const conn = await api.joinBreakoutRoom(id, breakoutId);
      switchingRef.current = true;
      setActiveConnection(conn);
      setActivePanel(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
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
        setError(e instanceof Error ? e.message : "Erreur inconnue");
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
      options={{ adaptiveStream: true, dynacast: true }}
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
        navigate("/");
      }}
    >
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
        </div>

        <div className="call-controlbar-wrapper">
          <CallControlBar
            roomId={activeConnection.room.id}
            canManage={canManage && !isInBreakout}
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

      <CallSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <RoomAudioRenderer />
      <StartAudio label="Cliquer pour activer le son" />
    </LiveKitRoom>
  );
}
