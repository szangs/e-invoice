// jscanify liefert keine eigenen TypeScript-Typen. Wird nur dynamisch
// importiert (client-seitig, siehe DocumentCamera.tsx) und arbeitet
// ohnehin auf dem global geladenen OpenCV.js (window.cv) — daher hier nur
// eine minimale Ambient-Deklaration statt vollständiger Typisierung.
declare module 'jscanify' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jscanify: new () => any
  export default jscanify
}
