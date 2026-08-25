// Microsoft-Identitätsplattform: OAuth2-Client-Credentials-Flow (App-only, kein Benutzer-Login).
// Wird sowohl für SMTP mit OAuth2 (XOAUTH2, Scope https://outlook.office365.com/.default)
// als auch für den Versand über Microsoft Graph (Scope https://graph.microsoft.com/.default) genutzt.
// Voraussetzung: Azure-AD-App-Registrierung mit Client-Secret und den passenden
// Anwendungsberechtigungen (Admin-Consent nötig).

type CachedToken = { accessToken: string; expiresAt: number }
const tokenCache = new Map<string, CachedToken>()

export async function getMsAccessToken(
  tenantId: string,
  clientId: string,
  clientSecret: string,
  scope: string,
): Promise<string> {
  const cacheKey = `${tenantId}:${clientId}:${scope}`
  const cached = tokenCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.accessToken

  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope,
      grant_type: 'client_credentials',
    }),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.error_description || data.error || 'Token-Anfrage bei Microsoft fehlgeschlagen')
  }

  tokenCache.set(cacheKey, { accessToken: data.access_token, expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000 })
  return data.access_token as string
}
