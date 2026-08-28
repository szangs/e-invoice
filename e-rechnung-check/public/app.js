/* E-Rechnung-Teaser — Frontend. Ruft den KoSIT-Prüfdienst auf dem vServer auf. */
(function () {
  'use strict'

  function meta(name) {
    var el = document.querySelector('meta[name="' + name + '"]')
    return (el && el.content && el.content.trim()) || ''
  }

  // API-Basis: <meta name="e-rechnung-api"> oder window.ERECHNUNG_API_BASE.
  // Leer lassen, wenn Seite und Dienst auf derselben Domain liegen (Default) —
  // dann wird /api/analyze relativ aufgerufen.
  var API_BASE = (window.ERECHNUNG_API_BASE || meta('e-rechnung-api')).replace(/\/+$/, '')
  var ANALYZE_URL = API_BASE + '/api/analyze'
  var API_TOKEN = meta('e-rechnung-api-token')
  var TS_SITEKEY = meta('e-rechnung-turnstile-sitekey')
  var turnstileToken = null

  // Cloudflare Turnstile nur laden, wenn ein Sitekey hinterlegt ist.
  if (TS_SITEKEY) {
    window.__erTurnstileCb = function (tok) {
      turnstileToken = tok
    }
    window.addEventListener('DOMContentLoaded', function () {
      var box = document.createElement('div')
      box.className = 'cf-turnstile'
      box.style.marginTop = '10px'
      box.setAttribute('data-sitekey', TS_SITEKEY)
      box.setAttribute('data-callback', '__erTurnstileCb')
      box.setAttribute('data-theme', 'light')
      var dz = document.getElementById('dropzone')
      if (dz) dz.appendChild(box)
      var s = document.createElement('script')
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
      s.async = true
      s.defer = true
      document.head.appendChild(s)
    })
  }

  var dropzone = document.getElementById('dropzone')
  var fileInput = document.getElementById('fileInput')
  var chooseBtn = document.getElementById('chooseBtn')
  var errorBox = document.getElementById('errorBox')
  var resultEl = document.getElementById('result')

  var MAX_BYTES = 15 * 1024 * 1024

  // ── Datei-Auswahl ────────────────────────────────────────────────────────
  chooseBtn.addEventListener('click', function () {
    fileInput.click()
  })
  dropzone.addEventListener('click', function (e) {
    if (e.target === chooseBtn) return
    fileInput.click()
  })
  dropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      fileInput.click()
    }
  })
  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files[0]) analyze(fileInput.files[0])
    fileInput.value = ''
  })
  ;['dragenter', 'dragover'].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) {
      e.preventDefault()
      dropzone.classList.add('drag')
    })
  })
  ;['dragleave', 'drop'].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) {
      e.preventDefault()
      if (ev === 'dragleave' && dropzone.contains(e.relatedTarget)) return
      dropzone.classList.remove('drag')
    })
  })
  dropzone.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
    if (f) analyze(f)
  })

  // ── Analyse ──────────────────────────────────────────────────────────────
  function setBusy(busy) {
    chooseBtn.disabled = busy
    chooseBtn.innerHTML = busy
      ? '<span class="spinner"></span> Prüfe &hellip;'
      : 'Datei auswählen'
  }

  function showError(msg) {
    errorBox.textContent = msg
    errorBox.classList.remove('hidden')
  }

  function analyze(file) {
    errorBox.classList.add('hidden')
    resultEl.classList.add('hidden')
    resultEl.innerHTML = ''

    var name = (file.name || 'rechnung').toLowerCase()
    if (!/\.(pdf|xml)$/.test(name)) {
      showError('Bitte eine PDF- (ZUGFeRD/Factur-X) oder XML-Rechnung (XRechnung) auswählen.')
      return
    }
    if (file.size > MAX_BYTES) {
      showError('Datei zu groß (max. 15 MB).')
      return
    }
    if (TS_SITEKEY && !turnstileToken) {
      showError('Die Bot-Prüfung lädt noch — bitte einen Moment und dann erneut versuchen.')
      return
    }

    var headers = {
      'Content-Type': file.type || (name.endsWith('.pdf') ? 'application/pdf' : 'application/xml'),
      'X-File-Name': encodeURIComponent(file.name || 'rechnung'),
    }
    if (API_TOKEN) headers['X-Api-Token'] = API_TOKEN
    if (turnstileToken) headers['X-Turnstile-Token'] = turnstileToken

    setBusy(true)
    fetch(ANALYZE_URL, { method: 'POST', headers: headers, body: file })
      .then(function (res) {
        return res.json().then(function (json) {
          return { ok: res.ok, status: res.status, json: json }
        })
      })
      .then(function (r) {
        if (!r.ok) {
          showError((r.json && r.json.error) || 'Prüfung fehlgeschlagen (Status ' + r.status + ').')
          return
        }
        renderResult(r.json)
      })
      .catch(function () {
        showError('Prüfdienst nicht erreichbar. Bitte später erneut versuchen.')
      })
      .finally(function () {
        setBusy(false)
        // Turnstile-Token ist einmalig — Widget für den nächsten Upload zurücksetzen.
        turnstileToken = null
        if (TS_SITEKEY && window.turnstile && window.turnstile.reset) {
          try {
            window.turnstile.reset()
          } catch (e) {
            /* ignore */
          }
        }
      })
  }

  // ── Helfer ───────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    })
  }

  function fmtAmount(v, currency) {
    if (v == null || v === '') return '—'
    var n = Number(v)
    if (!isFinite(n)) return '—'
    try {
      return new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency: currency || 'EUR',
      }).format(n)
    } catch (e) {
      return n.toFixed(2) + ' ' + (currency || '')
    }
  }

  var LEVEL_LABEL = {
    fatal: 'Fehler (fatal)',
    error: 'Fehler',
    warning: 'Warnung',
    information: 'Hinweis',
  }

  function kositVerdict(kosit) {
    if (!kosit.available) return '<span class="tag tag-warn">KoSIT-Prüfung nicht verfügbar</span>'
    if (kosit.scenarioMatched === false)
      return '<span class="tag tag-warn">KoSIT: kein passendes Prüfszenario</span>'
    return verdict(kosit.accepted, 'KoSIT: konform', 'KoSIT: nicht konform')
  }

  function verdict(ok, okText, failText) {
    if (ok == null) return ''
    return ok
      ? '<span class="tag tag-ok">✓ ' + esc(okText) + '</span>'
      : '<span class="tag tag-bad">✗ ' + esc(failText) + '</span>'
  }

  // ── Ergebnis rendern ─────────────────────────────────────────────────────
  function renderResult(r) {
    var data = r.data
    var formal = r.formal
    var kosit = r.kosit || { available: false, reason: 'Unbekannt' }
    var currency = (data && data.currency) || 'EUR'

    var head =
      '<div class="card"><div class="result-head">' +
      '<span class="tag tag-accent">' +
      esc(r.formatLabel || r.format) +
      '</span>' +
      '<span class="filename">' +
      esc(r.fileName) +
      '</span>' +
      '<span class="verdicts">' +
      verdict(
        formal ? formal.valid : null,
        'Pflichtangaben vollständig',
        'Pflichtangaben unvollständig',
      ) +
      kositVerdict(kosit) +
      '</span></div>' +
      '<p class="result-disclaimer">Automatisierte Auswertung ohne Gewähr — keine Rechts- oder ' +
      'Steuerberatung, ersetzt nicht die eigene Prüfung und Freigabe.</p>' +
      '</div>'

    var hasOriginal = kosit.available && kosit.reportHtml
    var hasXml = !!r.xml
    var tabs = [
      { id: 'bild', label: 'Rechnungsbild' },
      { id: 'bericht', label: 'Prüfbericht' },
    ]
    if (hasOriginal) tabs.push({ id: 'original', label: 'KoSIT-Originalbericht' })
    if (hasXml) tabs.push({ id: 'xml', label: 'XML' })

    var tabBar =
      '<div class="tabs">' +
      tabs
        .map(function (t, i) {
          return (
            '<button data-tab="' +
            t.id +
            '"' +
            (i === 0 ? ' class="active"' : '') +
            '>' +
            esc(t.label) +
            '</button>'
          )
        })
        .join('') +
      '</div>'

    var panels =
      '<div data-panel="bild">' +
      renderBild(data, currency, r.formatLabel) +
      '</div>' +
      '<div data-panel="bericht" class="hidden">' +
      renderBericht(formal, kosit) +
      '</div>' +
      (hasOriginal
        ? '<div data-panel="original" class="hidden">' + renderOriginal(kosit, r.fileName) + '</div>'
        : '') +
      (hasXml
        ? '<div data-panel="xml" class="hidden"><div class="card"><pre class="raw">' +
          esc(r.xml) +
          '</pre></div></div>'
        : '')

    resultEl.innerHTML = head + tabBar + panels
    resultEl.classList.remove('hidden')

    var buttons = resultEl.querySelectorAll('.tabs button')
    buttons.forEach(function (b) {
      b.addEventListener('click', function () {
        buttons.forEach(function (x) {
          x.classList.remove('active')
        })
        b.classList.add('active')
        var id = b.getAttribute('data-tab')
        resultEl.querySelectorAll('[data-panel]').forEach(function (p) {
          p.classList.toggle('hidden', p.getAttribute('data-panel') !== id)
        })
      })
    })

    wireDownloads(kosit, r.fileName)
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function field(label, value, mono) {
    return (
      '<div class="field"><label>' +
      esc(label) +
      '</label><div class="v' +
      (mono ? ' mono' : '') +
      '">' +
      esc(value == null || value === '' ? '—' : value) +
      '</div></div>'
    )
  }

  function renderBild(data, currency, formatLabel) {
    if (!data) {
      return (
        '<div class="card">Für dieses Format (' +
        esc(formatLabel) +
        ') liegen keine strukturierten Rechnungsdaten vor — es konnte kein E-Rechnungs-XML gelesen werden.</div>'
      )
    }
    var lines = ''
    if (data.lines && data.lines.length) {
      lines =
        '<table class="lines"><thead><tr><th>Position</th><th>Menge</th><th class="num">Betrag</th></tr></thead><tbody>' +
        data.lines
          .map(function (l) {
            return (
              '<tr><td>' +
              esc(l.name) +
              '</td><td>' +
              esc(l.quantity == null ? '—' : l.quantity) +
              '</td><td class="num">' +
              esc(fmtAmount(l.lineTotal, currency)) +
              '</td></tr>'
            )
          })
          .join('') +
        '</tbody></table>'
    }
    var totals =
      '<div class="totals">' +
      '<div class="row"><span>Netto</span><span>' +
      esc(fmtAmount(data.net, currency)) +
      '</span></div>' +
      '<div class="row"><span>Umsatzsteuer</span><span>' +
      esc(fmtAmount(data.tax, currency)) +
      '</span></div>' +
      '<div class="row sum"><span>Gesamtbetrag</span><span>' +
      esc(fmtAmount(data.gross, currency)) +
      '</span></div></div>'

    return (
      '<div class="card">' +
      '<div class="grid2">' +
      field('Rechnungsnummer', data.number, true) +
      field('Rechnungsdatum', data.issueDate) +
      field('Fällig am', data.dueDate) +
      field('Währung', data.currency) +
      field('Rechnungssteller', data.sellerName) +
      field('USt-ID / Steuernummer', data.sellerVatId, true) +
      field('Rechnungsempfänger', data.buyerName) +
      '</div>' +
      lines +
      totals +
      '</div>'
    )
  }

  function countTag(n, label, cls) {
    return '<span class="tag ' + cls + '">' + n + ' ' + esc(label) + '</span>'
  }

  function renderBericht(formal, kosit) {
    var formalBlock =
      '<div class="card stack">' +
      '<h3 class="blk">Formale Kernprüfung (EN 16931-Kern / §14 UStG)</h3>' +
      (formal == null
        ? '<p class="subtle">Keine strukturierten Daten zum Prüfen.</p>'
        : formal.valid
          ? '<p class="note-ok">✓ Alle geprüften Pflichtangaben sind vorhanden.</p>'
          : '<p class="note note-warn">Fehlend: ' + esc(formal.missing.join(', ')) + '</p>') +
      '<p class="subtle">Schnelle Plausibilitätsprüfung — ersetzt nicht die vollständige KoSIT-Validierung.</p>' +
      '</div>'

    var kositBlock
    if (!kosit.available) {
      kositBlock =
        '<div class="card stack">' +
        '<h3 class="blk">KoSIT-Validierung (Schematron / EN 16931 + XRechnung)</h3>' +
        '<p class="note note-warn">' +
        esc(kosit.reason || 'Nicht verfügbar.') +
        '</p></div>'
    } else {
      var msgs = kosit.messages || []
      var list = msgs.length
        ? msgs
            .map(function (m) {
              var cls =
                m.level === 'fatal' || m.level === 'error'
                  ? 'msg err'
                  : m.level === 'warning'
                    ? 'msg warn'
                    : 'msg'
              return (
                '<div class="' +
                cls +
                '"><div class="meta"><span class="lvl">' +
                esc(LEVEL_LABEL[m.level] || m.level) +
                '</span>' +
                (m.ruleId ? '<span class="rule">' + esc(m.ruleId) + '</span>' : '') +
                '</div><p class="txt">' +
                esc(m.text) +
                '</p>' +
                (m.location ? '<p class="loc">' + esc(m.location) + '</p>' : '') +
                '</div>'
              )
            })
            .join('')
        : '<p class="note-ok">✓ Keine Regelverletzungen.</p>'

      var c = kosit.counts || { fatal: 0, error: 0, warning: 0, information: 0 }
      var noScenario = kosit.scenarioMatched === false
      var badge = noScenario
        ? '<span class="tag tag-warn">kein passendes Prüfszenario</span>'
        : '<span class="tag ' +
          (kosit.accepted ? 'tag-ok' : 'tag-bad') +
          '">' +
          (kosit.accepted ? '✓ Empfehlung: annehmen' : '✗ Empfehlung: ablehnen') +
          '</span>'
      kositBlock =
        '<div class="card stack">' +
        '<div class="meta" style="display:flex;flex-wrap:wrap;align-items:center;gap:10px">' +
        '<h3 class="blk" style="margin:0">KoSIT-Validierung</h3>' +
        (kosit.scenario ? '<span class="tag tag-accent">' + esc(kosit.scenario) + '</span>' : '') +
        badge +
        '</div>' +
        (noScenario
          ? '<p class="note note-warn">Der KoSIT-Validator konnte die Datei keinem Prüfszenario ' +
            '(XRechnung 3.0.2 / EN 16931) zuordnen — daher keine Regelprüfung. Meist stimmt die ' +
            'CustomizationID bzw. Guideline-ID nicht.</p>'
          : '') +
        '<div class="counts">' +
        countTag(c.fatal, 'Fatal', 'tag-bad') +
        countTag(c.error, 'Fehler', 'tag-bad') +
        countTag(c.warning, 'Warnungen', 'tag-warn') +
        countTag(c.information, 'Hinweise', 'tag-muted') +
        '</div>' +
        '<div>' +
        list +
        '</div>' +
        '<p class="subtle">' +
        esc([kosit.engine, kosit.timestamp].filter(Boolean).join(' · ') || 'KoSIT-Validator') +
        '</p></div>'
    }

    return '<div class="stack">' + formalBlock + kositBlock + '</div>'
  }

  function renderOriginal(kosit, fileName) {
    return (
      '<div class="card stack">' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px">' +
      (kosit.reportHtml
        ? '<button class="btn btn-secondary" data-dl="html">HTML-Bericht herunterladen</button>'
        : '') +
      '<button class="btn btn-secondary" data-dl="xml">XML-Bericht herunterladen</button>' +
      '</div>' +
      (kosit.reportHtml
        ? '<iframe class="report" sandbox="" title="KoSIT-Prüfbericht"></iframe>'
        : '<pre class="raw">' + esc(kosit.reportXml || '') + '</pre>') +
      '</div>'
    )
  }

  function wireDownloads(kosit, fileName) {
    if (!kosit || !kosit.available) return
    var base = (fileName || 'rechnung').replace(/\.[^.]+$/, '') || 'rechnung'
    var frame = resultEl.querySelector('iframe.report')
    if (frame && kosit.reportHtml) frame.srcdoc = kosit.reportHtml

    resultEl.querySelectorAll('[data-dl]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var kind = btn.getAttribute('data-dl')
        var content = kind === 'html' ? kosit.reportHtml : kosit.reportXml
        var mime = kind === 'html' ? 'text/html' : 'application/xml'
        if (!content) return
        var blob = new Blob([content], { type: mime })
        var url = URL.createObjectURL(blob)
        var a = document.createElement('a')
        a.href = url
        a.download = base + '-kosit-report.' + kind
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
      })
    })
  }
})()
