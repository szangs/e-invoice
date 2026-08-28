// Rollen-Rechte-Matrix (Stefan 2026-08-27, "so etwas wie die Korb-Rechte
// müssen wir für die Rollen auch haben — was kann ich grob machen"): ergänzt
// die Korb-Rechte (lib/basketRights.ts — welche Körbe/Rechnungen darf ich
// sehen/bearbeiten) um eine QUERSCHNITTLICHE, vom einzelnen Korb unabhängige
// Ebene: darf diese Rolle überhaupt bestimmte Aktionen ausführen. Bewusst
// klein gehalten (vier Aktionen, kein Feld-für-Feld-Mikromanagement) — jede
// Aktion war vorher entweder komplett ungeregelt (nur übers Korb-Recht
// CONTENT erreichbar) oder fest im Code auf eine Rolle verdrahtet
// (Audit-Protokoll: nur Prüfer/Admin).
import { Role } from '@prisma/client'
import { alwaysFullAccess } from '@/lib/basketRights'

export const ROLE_ACTIONS = ['AI_EXTRACT', 'REQUEST_CORRECTION', 'IGNORE_CHECK', 'VIEW_AUDIT'] as const
export type RoleAction = (typeof ROLE_ACTIONS)[number]

export const ROLE_ACTION_LABELS: Record<RoleAction, string> = {
  AI_EXTRACT: 'KI-Erkennung nutzen',
  REQUEST_CORRECTION: 'Korrektur beim Lieferanten anfordern',
  IGNORE_CHECK: 'Pflichtangaben-Prüfung ignorieren',
  VIEW_AUDIT: 'Audit-Protokoll einsehen',
}

// Für diese Rollen ist die Matrix in der Benutzerverwaltung überhaupt
// anzeigbar/editierbar — Administrator und Betreiber haben nach
// alwaysFullAccess() immer alle Aktionen, unabhängig vom Matrix-Inhalt
// (dieselbe Sonderregel wie bei den Korb-Rechten).
export const CONFIGURABLE_ROLES: Role[] = [Role.EDITOR, Role.AREA_MANAGER, Role.AUDITOR, Role.USER]

export const ROLE_LABELS: Record<Role, string> = {
  OPERATOR_ADMIN: 'Betreiber',
  TENANT_ADMIN: 'Administrator',
  EDITOR: 'Bearbeiter',
  AREA_MANAGER: 'Bereichsleitung',
  AUDITOR: 'Prüfer',
  USER: 'Nutzer',
}

// Ist-Zustand VOR dieser Matrix als Vorbelegung (Stefan 2026-08-27): alle vier
// Aktionen waren bislang für jeden angemeldeten Mitarbeiter mit Korb-Zugriff
// offen — außer dem Audit-Protokoll, das schon immer fest auf Prüfer/Admin
// verdrahtet war. So verliert beim Rollout kein bestehender Mandant etwas;
// echte Einschränkungen sind danach bewusste Admin-Entscheidungen.
export const ROLE_ACTION_DEFAULTS: Record<Role, Record<RoleAction, boolean>> = {
  OPERATOR_ADMIN: { AI_EXTRACT: true, REQUEST_CORRECTION: true, IGNORE_CHECK: true, VIEW_AUDIT: true },
  TENANT_ADMIN: { AI_EXTRACT: true, REQUEST_CORRECTION: true, IGNORE_CHECK: true, VIEW_AUDIT: true },
  EDITOR: { AI_EXTRACT: true, REQUEST_CORRECTION: true, IGNORE_CHECK: true, VIEW_AUDIT: false },
  AREA_MANAGER: { AI_EXTRACT: true, REQUEST_CORRECTION: true, IGNORE_CHECK: true, VIEW_AUDIT: false },
  AUDITOR: { AI_EXTRACT: true, REQUEST_CORRECTION: true, IGNORE_CHECK: true, VIEW_AUDIT: true },
  USER: { AI_EXTRACT: true, REQUEST_CORRECTION: true, IGNORE_CHECK: true, VIEW_AUDIT: false },
}

type StoredMatrix = Partial<Record<Role, Partial<Record<RoleAction, boolean>>>>

/** Gespeicherte Abweichungen (Tenant.roleActions) mit den Vorgaben zu einer
 * vollständigen Matrix zusammengeführt — für die Anzeige/Bearbeitung in der
 * Benutzerverwaltung. */
export function getEffectiveRoleActionMatrix(stored: unknown): Record<Role, Record<RoleAction, boolean>> {
  const overrides = (stored ?? {}) as StoredMatrix
  const result = {} as Record<Role, Record<RoleAction, boolean>>
  for (const role of Object.values(Role)) {
    result[role] = { ...ROLE_ACTION_DEFAULTS[role], ...(overrides[role] ?? {}) }
  }
  return result
}

/** Eine einzelne Zelle setzen/löschen und die vollständige, zu speichernde
 * Rohstruktur zurückgeben (nur Abweichungen von den Vorgaben, nicht die
 * ganze Matrix) — für die PATCH-Route. */
export function withRoleActionOverride(
  stored: unknown,
  role: Role,
  action: RoleAction,
  enabled: boolean,
): StoredMatrix {
  const overrides = { ...((stored ?? {}) as StoredMatrix) }
  const roleOverrides = { ...(overrides[role] ?? {}) }
  if (ROLE_ACTION_DEFAULTS[role][action] === enabled) {
    // Entspricht wieder der Vorgabe — keinen unnötigen Abweichungs-Eintrag behalten.
    delete roleOverrides[action]
  } else {
    roleOverrides[action] = enabled
  }
  if (Object.keys(roleOverrides).length === 0) {
    delete overrides[role]
  } else {
    overrides[role] = roleOverrides
  }
  return overrides
}

/** Darf dieser Nutzer (anhand seiner Rolle) diese Aktion ausführen? Admin/
 * Betreiber immer ja (alwaysFullAccess, dieselbe Sonderregel wie bei den
 * Korb-Rechten). `tenant` darf null sein (z. B. Aufrufer hat nur die ID) —
 * dann gelten die Vorgaben. */
export function hasRoleAction(
  tenant: { roleActions: unknown } | null | undefined,
  role: Role,
  action: RoleAction,
): boolean {
  if (alwaysFullAccess(role)) return true
  const matrix = getEffectiveRoleActionMatrix(tenant?.roleActions)
  return matrix[role][action]
}
