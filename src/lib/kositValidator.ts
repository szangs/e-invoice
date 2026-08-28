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
import { getApprovalBlockers } from '@/lib/erechnung'
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
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      xmlData: true, taxRegion: true, sellerCountryCode: true,
      pflichtangabenIgnoredAt: true, checkFormalAt: true, checkFormalBy: true,
      invoiceClass: true, duplicateOfId: true, buyerNameMismatchAcknowledged: true, tenantId: true,
    },
  })
  if (!invoice?.xmlData || !isKositInstalled()) return null
  const result = await runKositValidation(invoice.xmlData)
  // "Formal richtig" automatisch aus dem Tool-Ergebnis setzen (Stefan
  // 2026-08-26, "direkt nach der automatischen Prüfung den grünen Haken
  // setzen"): nur wenn KoSIT akzeptiert UND keiner der Blocker greift, die
  // auch eine manuelle Freigabe verhindern würden (Review-Fund "KoSIT-
  // Hintergrundprüfung umgeht Freigabe-Sperren") — dieselbe getApprovalBlockers-
  // Funktion wie beim PATCH-Handler (api/invoices/[id]/route.ts), statt einer
  // eigenen Teil-Prüfung nur der Pflichtangaben, die Dublette/Spam-Verdacht/
  // Empfänger-Abweichung übersehen hätte. Lehnt KoSIT ab (oder greift ein
  // Blocker trotz KoSIT-Zustimmung), wird ein zuvor optimistisch gesetzter
  // Haken wieder zurückgenommen — aber NUR, wenn er noch von der eigenen
  // Automatik stammt (checkFormalBy beginnt mit "System (automatisch"), nie
  // eine bereits von einem Menschen bestätigte Prüfung überschreiben.
  const tenant = await prisma.tenant.findUnique({
    where: { id: invoice.tenantId },
    select: { legalName: true, buyerNameMismatchBlocksHandover: true },
  })
  const blockers = getApprovalBlockers(invoice, tenant ?? { legalName: null, buyerNameMismatchBlocksHandover: false })
  const wasAutoSet = invoice.checkFormalBy?.startsWith('System (automatisch') ?? false
  const definitelyNotOk = result.accepted === false || (result.accepted === true && blockers.length > 0)
  const formalUpdate =
    result.accepted === true && blockers.length === 0
      ? { checkFormalAt: new Date(), checkFormalBy: 'System (automatisch: KoSIT akzeptiert, Pflichtangaben vollständig)' }
      : definitelyNotOk && (wasAutoSet || !invoice.checkFormalAt)
        ? { checkFormalAt: null, checkFormalBy: null }
        : {}
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      kositCheckedAt: new Date(),
      kositAccepted: result.accepted,
      kositScenario: result.scenarioName,
      kositMessages: result.messages,
      ...formalUpdate,
    },
  })
  return result
}

/**
 * Fire-and-forget-Variante für den automatischen Hintergrund-Trigger direkt
 * nach Ablage — bewusst NICHT awaiten am Aufrufort (siehe Kommentar oben),
 * Fehler werden geloggt statt geworfen, damit ein Validator-Ausfall niemals
 * die Mail-Verarbeitung oder eine Upload-Anfrage zum Absturz bringt.
 *
 * Serialisiert über eine einfache FIFO-Kette (Stefan 2026-08-26, "einige
 * E-Rechnungen werden nicht geprüft"): vorher lief pro E-Rechnung sofort ein
 * eigener validator.jar-Prozess (JVM-Start, spürbarer Ressourcenbedarf) OHNE
 * jede Begrenzung — bei mehreren E-Rechnungen im selben Mail-Eingang-Batch
 * (z. B. Testversand) liefen dadurch etliche Prozesse gleichzeitig,
 * konkurrierten um CPU, und einzelne rissen das 30s-Timeout in
 * runKositValidation (SIGTERM, "code 143, killed: true") — die Prüfung blieb
 * für diese Rechnungen dauerhaft offen, kein automatischer Retry. Jetzt läuft
 * höchstens EINE Prüfung gleichzeitig, weitere warten in der Kette, bis die
 * aktuelle fertig ist — bei einem Massen-Eingang langsamer, aber zuverlässig
 * statt reihenweise timender Prüfungen. Rein prozesslokal (kein Redis o. Ä.
 * nötig, da derselbe lang laufende Poller-Prozess ohnehin alle Checks eines
 * Mandanten sequenziell aus demselben Mail-Abruf heraus auslöst).
 */
let kositQueue: Promise<void> = Promise.resolve()

/**
 * Wie scheduleKositCheck, aber awaitbar — für den manuellen "Jetzt/Erneut
 * prüfen"-Knopf (api/invoices/[id]/kosit-check/route.ts). Review-Fund
 * "'Jetzt prüfen' umgeht die neue KoSIT-Warteschlange": vorher rief die Route
 * runAndStoreKositCheck direkt auf, an der Warteschlange vorbei — ein
 * manueller Klick konnte so einen zweiten, unsynchronisierten validator.jar-
 * Prozess parallel zu einem gerade laufenden Warteschlangen-Eintrag starten
 * und genau die CPU-Konkurrenz/30s-Timeout-Situation reproduzieren, die die
 * Warteschlange eigentlich verhindern soll. Läuft jetzt über DIESELBE Kette
 * — der Aufrufer bekommt trotzdem das echte Ergebnis/einen echten Fehler
 * zurück (die Kette selbst bricht dabei nie ab, siehe unten).
 */
export function runKositCheckQueued(invoiceId: string): Promise<KositResult | null> {
  const run = kositQueue.then(() => runAndStoreKositCheck(invoiceId))
  // Die Kette selbst darf durch einen Fehlschlag NIE abbrechen (sonst bleiben
  // alle nachfolgend wartenden Einträge für immer hängen) — daher separat an
  // eine nie ablehnende Fortsetzung gekettet, während `run` den echten
  // Erfolg/Fehler an den Aufrufer weiterreicht.
  kositQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export function scheduleKositCheck(invoiceId: string): void {
  runKositCheckQueued(invoiceId).catch((e) => {
    console.error(`[kosit] Automatische Prüfung für Rechnung ${invoiceId} fehlgeschlagen:`, e)
  })
}
