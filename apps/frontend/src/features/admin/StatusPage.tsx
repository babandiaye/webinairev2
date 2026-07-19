import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { ComponentHealth, StatusComponentDto, SystemStatusDto } from "@webinairev2/shared-types";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthProvider";
import { DashboardLayout } from "../../components/layout/DashboardLayout";
import { Sparkline } from "../../components/charts/Sparkline";

const POLL_INTERVAL_MS = 5000;
// Fenêtre d'historique gardée côté navigateur pour les sparklines — choix
// "live seulement" acté avec l'utilisateur : pas de nouvelle table Postgres,
// repart à zéro à chaque rechargement de page (5s × 60 ≈ 5 minutes glissantes).
const HISTORY_LENGTH = 60;

const DETAIL_LABELS: Record<string, string> = {
  rooms: "Salles",
  participants: "Participants",
  active: "Actifs",
  configured: "Configurés",
  connections: "Connexions",
  memoryBytes: "Mémoire",
  total: "Total reçus",
  lastReceivedAt: "Dernier reçu",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

function formatRelativeTime(iso: string): string {
  const diffSeconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSeconds < 60) return `il y a ${diffSeconds}s`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `il y a ${diffMinutes}min`;
  return `il y a ${Math.floor(diffMinutes / 60)}h`;
}

function formatDetailValue(key: string, value: number | string): string {
  if (key === "memoryBytes") return formatBytes(Number(value));
  if (key === "lastReceivedAt") return value === "never" ? "jamais" : formatRelativeTime(String(value));
  return String(value);
}

// Le pire des statuts individuels détermine le bandeau de synthèse global —
// down l'emporte sur degraded, qui l'emporte sur up.
const HEALTH_RANK: Record<ComponentHealth, number> = { up: 0, degraded: 1, down: 2 };

function worstHealth(components: StatusComponentDto[]): ComponentHealth {
  return components.reduce<ComponentHealth>(
    (worst, c) => (HEALTH_RANK[c.status] > HEALTH_RANK[worst] ? c.status : worst),
    "up"
  );
}

const SUMMARY_LABELS: Record<ComponentHealth, string> = {
  up: "Tous les systèmes sont opérationnels",
  degraded: "Fonctionnement dégradé",
  down: "Incident en cours",
};

function StatusDot({ status }: { status: ComponentHealth }) {
  const Icon = status === "up" ? CheckCircle2 : status === "degraded" ? AlertTriangle : XCircle;
  return <Icon size={16} className={`status-dot status-dot-${status}`} />;
}

function ComponentCard({ component }: { component: StatusComponentDto }) {
  return (
    <div className={`panel status-card status-card-${component.status}`}>
      <div className="status-card-header">
        <div className="status-card-title">
          <StatusDot status={component.status} />
          <span>{component.label}</span>
        </div>
        {component.latencyMs !== undefined && <span className="status-latency">{component.latencyMs}ms</span>}
      </div>
      {component.details && (
        <div className="status-metrics">
          {Object.entries(component.details).map(([key, value]) => (
            <div className="status-metric" key={key}>
              <span className="status-metric-value">{formatDetailValue(key, value)}</span>
              <span className="status-metric-label">{DETAIL_LABELS[key] ?? key}</span>
            </div>
          ))}
        </div>
      )}
      {component.error && <p className="status-card-error">{component.error}</p>}
    </div>
  );
}

function HostGauge({
  label,
  percent,
  detail,
  history,
}: {
  label: string;
  percent: number;
  detail: string;
  history: number[];
}) {
  // Mêmes seuils que les pastilles de composant (vert < 70%, ambre < 90%, rouge au-delà) —
  // une charge hôte élevée est un signal avant-coureur, pas encore une panne.
  const health: ComponentHealth = percent >= 90 ? "down" : percent >= 70 ? "degraded" : "up";
  return (
    <div className="panel status-card">
      <div className="status-card-header">
        <div className="status-card-title">
          <StatusDot status={health} />
          <span>{label}</span>
        </div>
        <span className="status-latency">{detail}</span>
      </div>
      <div className={`status-gauge-track status-gauge-${health}`}>
        <div className="status-gauge-fill" style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
      {/* status-dot-{health} pilote juste la couleur (currentColor) reprise par le SVG,
          pas une vraie pastille ici — réutilise le même trio de classes de couleur. */}
      <div className={`status-sparkline-wrap status-dot-${health}`}>
        <Sparkline values={history} />
      </div>
    </div>
  );
}

export function StatusPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<SystemStatusDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cpuHistoryRef = useRef<number[]>([]);
  const memHistoryRef = useRef<number[]>([]);
  const participantsHistoryRef = useRef<number[]>([]);
  // Forcer un re-render après avoir poussé dans les refs d'historique ci-dessus
  // (des refs seules ne déclenchent pas de rendu) — plus léger qu'un useState
  // par série, on n'a besoin que d'un "tick" pour que les sparklines se redessinent.
  const [, setHistoryTick] = useState(0);

  useEffect(() => {
    if (user?.role !== "ADMIN") return;

    let cancelled = false;
    function poll() {
      api
        .getSystemStatus()
        .then((s) => {
          if (cancelled) return;
          setStatus(s);
          setError(null);

          const cpuPercent = (s.host.cpuLoad1m / s.host.cpuCount) * 100;
          const memPercent = (s.host.memUsedBytes / s.host.memTotalBytes) * 100;
          const livekit = s.components.find((c) => c.id === "livekit");
          const participants = Number(livekit?.details?.participants ?? 0);

          for (const [ref, value] of [
            [cpuHistoryRef, cpuPercent],
            [memHistoryRef, memPercent],
            [participantsHistoryRef, participants],
          ] as const) {
            ref.current = [...ref.current, value].slice(-HISTORY_LENGTH);
          }
          setHistoryTick((t) => t + 1);
        })
        .catch((e) => {
          if (!cancelled) setError(e instanceof Error ? e.message : "Erreur inconnue");
        });
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user]);

  if (!user) return null;
  if (user.role !== "ADMIN") return <Navigate to="/" replace />;

  const overall = status ? worstHealth(status.components) : null;

  return (
    <DashboardLayout user={user} search={search} onSearchChange={setSearch}>
      <div className="dashboard-welcome">
        <h2>Statut système</h2>
        <p>État de l'infrastructure LiveKit (SFU, Egress, Ingress), du stockage et des bases de données.</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {status && overall && (
        <div className={`status-summary-bar status-summary-${overall}`}>
          <StatusDot status={overall} />
          <span>{SUMMARY_LABELS[overall]}</span>
          <span className="status-summary-timestamp">
            Actualisé {formatRelativeTime(status.timestamp)}
          </span>
        </div>
      )}

      {status && (
        <>
          <div className="status-grid" style={{ marginTop: 20 }}>
            <HostGauge
              label="CPU (hôte)"
              percent={(status.host.cpuLoad1m / status.host.cpuCount) * 100}
              detail={`charge ${status.host.cpuLoad1m.toFixed(2)} / ${status.host.cpuCount} cœurs`}
              history={cpuHistoryRef.current}
            />
            <HostGauge
              label="RAM (hôte)"
              percent={(status.host.memUsedBytes / status.host.memTotalBytes) * 100}
              detail={`${formatBytes(status.host.memUsedBytes)} / ${formatBytes(status.host.memTotalBytes)}`}
              history={memHistoryRef.current}
            />
          </div>

          <div className="status-grid" style={{ marginTop: 12 }}>
            {status.components.map((c) => (
              <ComponentCard component={c} key={c.id} />
            ))}
          </div>
        </>
      )}
    </DashboardLayout>
  );
}
