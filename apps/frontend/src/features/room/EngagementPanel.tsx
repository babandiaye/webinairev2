import { Download, FileText, Mic, MicOff, Video, VideoOff, X } from "lucide-react";
import {
  formatDuration,
  useEngagementSnapshot,
  type ParticipantEngagement,
} from "./useEngagementStats";

const COLUMNS = [
  "Participant",
  "Rôle",
  "Présence",
  "Temps de parole",
  "Prises de parole",
  "Messages",
  "Connexions",
  "État",
] as const;

function roleLabel(row: ParticipantEngagement): string {
  return row.isModerator ? "Animateur" : "Participant";
}

function stateLabel(row: ParticipantEngagement): string {
  return row.present ? "Présent" : "Parti";
}

// Séparateur point-virgule et BOM UTF-8 : sans les deux, Excel en configuration
// française ouvre le fichier sur une seule colonne et casse tous les accents.
// LibreOffice s'accommode des deux conventions, Excel non — c'est donc lui qui
// dicte le format.
function buildCsv(rows: ParticipantEngagement[]): string {
  const escape = (value: string | number) => {
    const text = String(value);
    return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const lines = [
    COLUMNS.join(";"),
    ...rows.map((row) =>
      [
        escape(row.name),
        roleLabel(row),
        formatDuration(row.presenceMs),
        formatDuration(row.talkMs),
        row.talkTurns,
        row.chatMessages,
        row.connections,
        stateLabel(row),
      ].join(";")
    ),
  ];
  return "﻿" + lines.join("\r\n");
}

function downloadCsv(rows: ParticipantEngagement[], roomTitle: string) {
  const blob = new Blob([buildCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  link.download = `engagement-${roomTitle.replace(/[^\w-]+/g, "_")}-${stamp}.csv`;
  // Firefox ignore un clic sur un lien détaché du document.
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// La règle d'impression masque tout sauf le relevé — elle ne doit donc valoir
// que pendant CETTE impression. Sans ce marqueur sur <body>, un Ctrl+P depuis
// n'importe quelle autre page de l'application ne sortirait qu'une feuille
// blanche.
function printReport() {
  document.body.classList.add("printing-engagement");
  const cleanup = () => {
    document.body.classList.remove("printing-engagement");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
  // Filet : `print()` rend la main à la fermeture de la boîte de dialogue sur
  // les navigateurs de bureau, mais `afterprint` n'est pas garanti partout.
  cleanup();
}

/**
 * Tableau de bord d'engagement de la séance en cours, à la façon du *Learning
 * Analytics Dashboard* de BigBlueButton : entièrement live, calculé dans le
 * navigateur (voir useEngagementStats pour le pourquoi), jamais stocké.
 *
 * Les chiffres disparaissent donc à la fermeture de l'onglet — les exports CSV
 * et PDF sont le seul moyen d'en garder une trace, et c'est délibéré.
 */
export function EngagementPanel({
  open,
  onClose,
  roomTitle,
}: {
  open: boolean;
  onClose: () => void;
  roomTitle: string;
}) {
  // Aucun échantillonnage tant que le panneau est fermé : les compteurs
  // continuent d'être alimentés par les évènements, seul l'affichage s'arrête.
  const rows = useEngagementSnapshot(open);

  if (!open) return null;

  const present = rows.filter((r) => r.present).length;
  const totalTalkMs = rows.reduce((sum, r) => sum + r.talkMs, 0);
  const moderatorTalkMs = rows.filter((r) => r.isModerator).reduce((sum, r) => sum + r.talkMs, 0);
  // Part de parole des participants : l'indicateur que BBB met en avant, parce
  // qu'un cours où elle reste à 0 % signale un amphi muet, pas une classe
  // attentive.
  const participantShare =
    totalTalkMs > 0 ? Math.round(((totalTalkMs - moderatorTalkMs) / totalTalkMs) * 100) : 0;

  return (
    <div className="breakout-panel engagement-panel">
      <div className="breakout-panel-header">
        <span>Engagement de la séance</span>
        <div className="engagement-header-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => downloadCsv(rows, roomTitle)}>
            <Download size={14} />
            CSV
          </button>
          {/* PDF via la boîte d'impression du navigateur ("Enregistrer au format
              PDF") plutôt qu'une bibliothèque de génération : celle-ci pèserait
              plusieurs centaines de kilo-octets dans un paquet déjà lourd, pour
              un résultat que le navigateur produit nativement. */}
          <button className="btn btn-ghost btn-sm" onClick={printReport}>
            <FileText size={14} />
            PDF
          </button>
          <button className="icon-btn" onClick={onClose} title="Fermer">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="breakout-panel-section">
        <div className="engagement-summary">
          <div className="engagement-stat">
            <span className="engagement-stat-value">{present}</span>
            <span className="engagement-stat-label">Présents</span>
          </div>
          <div className="engagement-stat">
            <span className="engagement-stat-value">{rows.length}</span>
            <span className="engagement-stat-label">Vus depuis le début</span>
          </div>
          <div className="engagement-stat">
            <span className="engagement-stat-value">{formatDuration(totalTalkMs)}</span>
            <span className="engagement-stat-label">Parole cumulée</span>
          </div>
          <div className="engagement-stat">
            <span className="engagement-stat-value">{participantShare} %</span>
            <span className="engagement-stat-label">Part des participants</span>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="empty-state">Aucune donnée pour l'instant.</p>
        ) : (
          <div className="engagement-table-wrap">
            <table className="engagement-table">
              <thead>
                <tr>
                  <th>Participant</th>
                  <th>Présence</th>
                  <th>Parole</th>
                  <th>Prises</th>
                  <th>Msg</th>
                  <th>Cnx</th>
                  <th>État</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.identity} className={row.present ? "" : "engagement-row-gone"}>
                    <td>
                      <div className="engagement-name">
                        <span>{row.name}</span>
                        {row.isModerator && <span className="engagement-badge">Animateur</span>}
                      </div>
                    </td>
                    <td>{formatDuration(row.presenceMs)}</td>
                    <td>
                      <div className="engagement-talk">
                        <span>{formatDuration(row.talkMs)}</span>
                        <div className="engagement-bar-track">
                          <div
                            className="engagement-bar-fill"
                            style={{
                              width: totalTalkMs > 0 ? `${(row.talkMs / totalTalkMs) * 100}%` : "0%",
                            }}
                          />
                        </div>
                      </div>
                    </td>
                    <td>{row.talkTurns}</td>
                    <td>{row.chatMessages}</td>
                    <td>{row.connections}</td>
                    <td>
                      <div className="engagement-state">
                        {row.micOn ? <Mic size={13} /> : <MicOff size={13} />}
                        {row.cameraOn ? <Video size={13} /> : <VideoOff size={13} />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="engagement-note">
          Ces chiffres ne sont pas enregistrés : ils vivent le temps de la séance et de cet onglet.
          Exportez-les avant de fermer.
        </p>
      </div>

      {/* Version imprimable : masquée à l'écran, seule visible à l'impression
          (voir @media print dans styles.css). Un tableau à part plutôt qu'une
          adaptation de celui du dessus — les barres, icônes et couleurs du
          panneau ne veulent rien dire sur une feuille en noir et blanc. */}
      <div className="engagement-print">
        <h1>Engagement — {roomTitle}</h1>
        <p>Édité le {new Date().toLocaleString("fr-FR")}</p>
        <table>
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.identity}>
                <td>{row.name}</td>
                <td>{roleLabel(row)}</td>
                <td>{formatDuration(row.presenceMs)}</td>
                <td>{formatDuration(row.talkMs)}</td>
                <td>{row.talkTurns}</td>
                <td>{row.chatMessages}</td>
                <td>{row.connections}</td>
                <td>{stateLabel(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
