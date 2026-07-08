// Lizenz-/Tarifsystem (Stefan 2026-07-09, #105/#115) — steuert, welche
// Funktionsblöcke ein Mandant nutzen darf. Tenant.licensePlan ist ein
// bestehendes Feld (bisher nur Freitext/Dokumentation im Betreiber-Cockpit,
// OHNE jede Auswirkung) — wird hier erstmals tatsächlich ausgewertet.
//
// Leer/unbekannt = BETA (= aktuelles Verhalten: alles frei). Das ist
// Absicht: bestehende und neue Mandanten dürfen durch die Einführung dieses
// Systems NICHT plötzlich eingeschränkt werden, solange kein Tarif explizit
// gesetzt ist (Stefan: "erst mal als Beta mit allen Funktionen freigeschaltet").
//
// Abgelaufene Lizenz (licenseExpiresAt in der Vergangenheit) fällt
// automatisch auf FREE zurück statt zu sperren (Stefan-Entscheidung
// 2026-07-09, siehe KONZEPT_LIZENZ_BASISVERSION.md Abschnitt 5) — kein
// Totalausfall für Kunden mit laufenden GoBD-Pflichten.
//
// WICHTIG (Stand 2026-07-09): dieses Gate ist bisher nur an einzelnen,
// klar abgrenzbaren Stellen eingebaut (KI, Verschlüsselung, Kostenstellen,
// DATEV-Export, API-Token/Rechnungs-Catcher — siehe Aufrufer von
// hasFeature()). Körbe/Workflow, Mehrbenutzer und Korb-Rechte sind
// strukturell tief im Programm verwoben (Dutzende Dateien) und BEWUSST NOCH
// NICHT gesperrt — das braucht einen eigenen, sorgfältigeren Durchgang statt
// hier in Eile halb fertig eingebaut zu werden.
import type { Tenant } from '@prisma/client'

export type Plan = 'BETA' | 'FREE' | 'TARIF1' | 'TARIF2'

export const PLANS: Plan[] = ['BETA', 'FREE', 'TARIF1', 'TARIF2']

export const PLAN_LABELS: Record<Plan, string> = {
  BETA: 'Beta (alles frei)',
  FREE: 'Frei (nur Revisionssicherheit)',
  TARIF1: 'Tarif 1',
  TARIF2: 'Tarif 2',
}

export type Feature =
  | 'BASKETS' // Körbe/Workflow (Eingang→Prüfung→Übergabe) — Gate noch NICHT eingebaut, siehe oben
  | 'MULTI_USER' // mehr als 1 Benutzer — Gate noch NICHT eingebaut, siehe oben
  | 'BASKET_RIGHTS' // Korb-Rechte, Vier-Augen-Prinzip — Gate noch NICHT eingebaut, siehe oben
  | 'DATEV' // DATEV-Export
  | 'AI' // KI-Erkennung
  | 'ENCRYPTION' // Zero-Knowledge Beleg-Verschlüsselung
  | 'COST_CENTERS' // Kostenstellen/Kostenträger
  | 'CATCHER' // Rechnungs-Catcher Browser-Plugin (API-Token)

const FEATURES_BY_PLAN: Record<Plan, 'ALL' | Set<Feature>> = {
  BETA: 'ALL',
  FREE: new Set<Feature>([]),
  TARIF1: new Set<Feature>(['BASKETS', 'MULTI_USER', 'DATEV', 'AI']),
  TARIF2: new Set<Feature>([
    'BASKETS', 'MULTI_USER', 'BASKET_RIGHTS', 'DATEV', 'AI', 'ENCRYPTION', 'COST_CENTERS', 'CATCHER',
  ]),
}

type TenantPlanFields = Pick<Tenant, 'licensePlan' | 'licenseExpiresAt'>

/** Effektiver Tarif unter Berücksichtigung des Ablaufdatums. */
export function effectivePlan(tenant: TenantPlanFields): Plan {
  const raw: Plan = tenant.licensePlan && (PLANS as string[]).includes(tenant.licensePlan) ? (tenant.licensePlan as Plan) : 'BETA'
  if (raw !== 'FREE' && tenant.licenseExpiresAt && tenant.licenseExpiresAt.getTime() < Date.now()) {
    return 'FREE'
  }
  return raw
}

export function hasFeature(tenant: TenantPlanFields, feature: Feature): boolean {
  const features = FEATURES_BY_PLAN[effectivePlan(tenant)]
  return features === 'ALL' || features.has(feature)
}

/** Kurzer, für Fehlermeldungen geeigneter Text, welcher Tarif eine Funktion freischaltet. */
export function featureLabel(feature: Feature): string {
  const labels: Record<Feature, string> = {
    BASKETS: 'Körbe/Workflow',
    MULTI_USER: 'Mehrbenutzer',
    BASKET_RIGHTS: 'Korb-Rechte',
    DATEV: 'DATEV-Export',
    AI: 'KI-Erkennung',
    ENCRYPTION: 'Beleg-Verschlüsselung',
    COST_CENTERS: 'Kostenstellen/Kostenträger',
    CATCHER: 'Rechnungs-Catcher',
  }
  return labels[feature]
}
