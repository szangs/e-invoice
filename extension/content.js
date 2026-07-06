// Rechnungs-Catcher — Content-Script
// Strg+Alt+Klick auf einen Link fängt die Datei, statt ihr normal zu folgen.
document.addEventListener(
  'click',
  (e) => {
    if (!(e.ctrlKey && e.altKey)) return
    const link = e.target instanceof Element ? e.target.closest('a[href]') : null
    if (!link) return
    e.preventDefault()
    e.stopPropagation()

    // kurzes visuelles Feedback am angeklickten Element
    const prevOutline = link.style.outline
    link.style.outline = '3px solid #1e477a'
    setTimeout(() => {
      link.style.outline = prevOutline
    }, 1200)

    chrome.runtime.sendMessage({
      type: 'catch',
      url: link.href,
      filename: (link.getAttribute('download') || '').trim(),
      pageUrl: location.href,
    })
  },
  true,
)
