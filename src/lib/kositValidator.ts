// KoSIT-Validator: Ausführung (Stefan 2026-08-26) — ruft das bereits
// installierte validator.jar (siehe lib/kositSetup.ts für Installation/
// Update) als Subprozess auf und wertet den XML-Prüfbericht aus. Ergänzt
// die eigene, schnelle Pflichtangaben-Prüfung (lib/erechnung.ts
// validateData) um die offizielle, rechtsverbindliche Schema-/Schematron-
// Konformitätsprüfung der Koordinierungsstelle für IT-Standards (KoSIT).
//
// Läuft automatisch im Hintergrund (Stefan 2026-08-26, siehe
// scheduleKositCheck unten) direkt nach Ablage jeder E-Rechnung mit
// gespeichertem xmlData (lib/mailin.ts, api/invoices/route.ts) — bewusst
// NICHT im Anfrage-/Poller-Pfad selbst abgewartet (Java-Start dauert ein
// paar Sekunden), sondern per fire-and-forget, damit weder ein einzelner
// HTTP-Request noch die Mail-Verarbeitung dadurch langsamer wird. Zusätzlich
// weiterhin jederzeit manuell im Prüfbericht erneut auslösbar (api/invoices/
// [id]/kosit-check/route.ts), z. B. nachdem der Validator nachträglich
// installiert wurde.
import { execFile } from 'child_process'
import { XMLParser } from 'fast-xml-parser'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { prisma } from '@/lib/db'
import { CONFIG_DIR, isKositInstalled, JAVA_BIN, SCENARIOS_FILE, VALIDATOR_JAR } from '@/lib/kositSetup'

const execFileAsync = promisify(execFile)

export type KositMessage = { level: string; code: string | null; text: string }
export type KositResult = {
  structurallyValid: boolean
  accepted: boolean | null // null = kein Verdict im Bericht gefunden (unerwartetes Format)
  scenarioName: string | null
  messages: KositMessage[]
}

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return []
  return Array.isArray(v) ? v : [v]
}

function parseReport(reportXml: string): KositResult {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const report = parser.parse(reportXml).report as any
  const structurallyValid = report?.['@_valid'] === 'true' || report?.['@_valid'] === true
  const assessment = report?.assessment ?? {}
  const accepted = 'accept' in assessment ? true : 'reject' in assessment ? false : null
  const scenarioName = report?.scenarioMatched?.scenario?.name ?? null
  // Kein passendes Szenario gefunden (z. B. kaputtes/kein XRechnung-XML):
  // dann steht der Prüfschritt unter "noScenarioMatched" statt "scenarioMatched".
  const steps = toArray(report?.scenarioMatched?.validationStepResult ?? report?.noScenarioMatched?.validationStepResult)
  const messages: KositMessage[] = steps.flatMap((step) =>
    toArray(step?.message).map((m) => ({
      level: m?.['@_level'] ?? 'information',
      code: m?.['@_code'] ?? null,
      text: typeof m === 'object' ? String(m?.['#text'] ?? '').trim() : String(m).trim(),
    })),
  )
  return { structurallyValid, accepted, scenarioName, messages }
}

/**
 * Führt die offizielle KoSIT-Prüfung gegen eine XRechnung-XML (UBL oder CII)
 * aus. Wirft einen Fehler, wenn der Validator nicht installiert ist (siehe
 * lib/kositSetup.ts installOrUpdateKositValidator) oder Java fehlschlägt.
 */
export async function runKositValidation(xml: string): Promise<KositResult> {
  if (!isKositInstalled()) {
    throw new Error('KoSIT-Validator ist nicht installiert — bitte im Betreiber-Cockpit einrichten.')
  }
  const workDir = path.join(os.tmpdir(), `kosit-${randomUUID()}`)
  await mkdir(workDir, { recursive: true })
  const inputFile = path.join(workDir, 'input.xml')
  const reportPath = path.join(workDir, 'input-report.xml')
  await writeFile(inputFile, xml, 'utf8')
  try {
    try {
      await execFileAsync(
        JAVA_BIN,
        ['-jar', VALIDATOR_JAR, '-s', SCENARIOS_FILE, '-r', CONFIG_DIR, '-o', workDir, '-h', inputFile],
        { timeout: 30_000 },
      )
    } catch (execError) {
      // Der Validator beendet sich mit Exit-Code 1, wenn das Ergebnis REJECT
      // ist (kein Programmfehler, sondern ein gültiges Prüfergebnis) — der
      // Bericht wird trotzdem geschrieben. Nur wenn der auch fehlt, war es
      // ein echter Ausführungsfehler (z. B. Java/Datei-Problem).
      if (!existsSync(reportPath)) throw execError
    }
    const reportXml = await readFile(reportPath, 'utf8')
    return parseReport(reportXml)
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

/**
 * Führt die KoSIT-Prüfung für eine bereits abgelegte Rechnung aus und
 * schreibt das Ergebnis in die Invoice-Zeile (kositCheckedAt/-Accepted/
 * -Scenario/-Messages) — von der manuellen "Jetzt/Erneut prüfen"-Route
 * UND vom automatischen Hintergrund-Trigger (scheduleKositCheck) genutzt,
 * damit beide Wege dasselbe, für die Listen-/Detailanzeige gespeicherte
 * Ergebnis liefern. Kein Fehler nach außen bei fehlendem xmlData/Validator
 * — ruft man ihn automatisch für jede Rechnung auf, ist "nicht anwendbar"
 * der Normalfall (Nicht-E-Rechnung) und kein Ausnahmefall.
 */
export async function runAndStoreKositCheck(invoiceId: string): Promise<KositResult | null> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { xmlData: true } })
  if (!invoice?.xmlData || !isKositInstalled()) return null
  const result = await runKositValidation(invoice.xmlData)
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      kositCheckedAt: new Date(),
      kositAccepted: result.accepted,
      kositScenario: result.scenarioName,
      kositMessages: result.messages,
    },
  })
  return result
}

/**
 * Fire-and-forget-Variante für den automatischen Hintergrund-Trigger direkt
 * nach Ablage — bewusst NICHT awaiten am Aufrufort (siehe Kommentar oben),
 * Fehler werden geloggt statt geworfen, damit ein Validator-Ausfall niemals
 * die Mail-Verarbeitung oder eine Upload-Anfrage zum Absturz bringt.
 */
export function scheduleKositCheck(invoiceId: string): void {
  runAndStoreKositCheck(invoiceId).catch((e) => {
    console.error(`[kosit] Automatische Prüfung für Rechnung ${invoiceId} fehlgeschlagen:`, e)
  })
}
