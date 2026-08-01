import { Role } from "@prisma/client";

export const CSV_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const CSV_IMPORT_BATCH_SIZE = 500;
const CSV_VALID_ROLES: Role[] = ["ADMIN", "MODERATOR", "VIEWER"];

export interface CsvRow {
  email: string;
  name: string;
  role: Role;
}

/**
 * Analyse un CSV d'utilisateurs.
 *
 * Format toléré : virgule ou point-virgule, en-tête optionnel (détecté via
 * "email"/"mail" sur la 1ère ligne), colonnes prenom/nom/role optionnelles et
 * repérées par leur nom plutôt que leur position — reprend le format déjà en
 * usage sur livestreamv3 (import-csv), avec une colonne "role" en plus.
 *
 * Partagé entre l'import d'utilisateurs (UsersService, réservé aux admins) et
 * l'inscription en masse à un cours (EnrollmentsService, ouvert aux
 * enseignants) : un enseignant qui prépare son fichier ne doit pas avoir à
 * connaître deux conventions selon la page où il le dépose. Le second IGNORE
 * délibérément la colonne "role" — voir EnrollmentsService.importFromCsv.
 */
export function parseCsvRows(text: string): CsvRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const sep = lines[0].includes(";") ? ";" : ",";
  const firstLower = lines[0].toLowerCase();
  const hasHeader = firstLower.includes("email") || firstLower.includes("mail");
  const dataLines = hasHeader ? lines.slice(1) : lines;

  let emailCol = 0;
  let prenomCol = -1;
  let nomCol = -1;
  let roleCol = -1;
  if (hasHeader) {
    const headers = lines[0]
      .toLowerCase()
      .split(sep)
      .map((h) => h.trim());
    emailCol = headers.findIndex((h) => h.includes("email") || h.includes("mail"));
    prenomCol = headers.findIndex(
      (h) =>
        h.includes("prenom") || h.includes("prénom") || h.includes("firstname") || h.includes("first")
    );
    nomCol = headers.findIndex(
      (h) =>
        (h.includes("nom") && !h.includes("prenom") && !h.includes("prénom")) ||
        h.includes("lastname") ||
        h.includes("last")
    );
    roleCol = headers.findIndex((h) => h.includes("role") || h.includes("rôle"));
    if (emailCol === -1) emailCol = 0;
  }

  const rows: CsvRow[] = [];
  for (const line of dataLines) {
    const cols = line.split(sep).map((c) => c.trim().replace(/^["']|["']$/g, ""));
    const email = cols[emailCol] ?? cols.find((c) => CSV_EMAIL_RE.test(c)) ?? "";
    if (!CSV_EMAIL_RE.test(email)) continue;

    const prenom = prenomCol >= 0 ? (cols[prenomCol] ?? "") : "";
    const nom =
      nomCol >= 0
        ? (cols[nomCol] ?? "")
        : prenomCol >= 0 && cols.length > prenomCol + 1
          ? (cols[prenomCol + 1] ?? "")
          : "";
    const name = [prenom, nom].filter(Boolean).join(" ") || email.split("@")[0];

    const roleRaw = roleCol >= 0 ? (cols[roleCol] ?? "").toUpperCase() : "";
    const role = (CSV_VALID_ROLES as string[]).includes(roleRaw) ? (roleRaw as Role) : Role.VIEWER;

    rows.push({ email: email.toLowerCase(), name, role });
  }
  return rows;
}
