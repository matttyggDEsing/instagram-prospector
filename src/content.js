// IG Growth Prospector - Content Script
// Extrae datos del perfil de Instagram desde el DOM visible

(function () {
  'use strict';

  // ─── Utilidades DOM ───────────────────────────────────────────────────────
  function getText(selector, root = document) {
    const el = root.querySelector(selector);
    return el ? el.innerText.trim() : null;
  }

  function getMeta(property) {
    const el = document.querySelector(`meta[property="${property}"]`) ||
               document.querySelector(`meta[name="${property}"]`);
    return el ? el.getAttribute('content') : null;
  }

  // ─── Parser de números con sufijos (1.2M, 45.3K, etc.) ───────────────────
  function parseNumber(str) {
    if (!str) return 0;
    str = String(str).trim();

    // Si tiene sufijo K/M/B, el punto/coma es decimal -> usar parseFloat directo
    const suffixMatch = str.match(/([\d.,]+)\s*([KkMmBb])\b/);
    if (suffixMatch) {
      const num = parseFloat(suffixMatch[1].replace(',', '.'));
      const suffix = suffixMatch[2].toUpperCase();
      let mult = 1;
      if (suffix === 'K') mult = 1000;
      if (suffix === 'M') mult = 1000000;
      if (suffix === 'B') mult = 1000000000;
      return Math.round(num * mult);
    }

    // Sin sufijo: los puntos y comas son separadores de miles (formatos en/es)
    const plain = str.match(/[\d.,]+/);
    if (!plain) return parseInt(str) || 0;
    const cleaned = plain[0].replace(/[.,]/g, '');
    return parseInt(cleaned) || 0;
  }

  // ─── Extracción de stats (followers/following/posts) desde el header ─────
  // Soporta inglés y español (Instagram muestra el idioma según el navegador)
  const STAT_KEYWORDS = {
    followers: /follower|seguidor/i,
    following: /following|siguiendo/i,
    posts: /post|publicaci/i
  };

  function getStatsFromHeader() {
    const result = {};
    // Estructura típica: header section ul li
    const items = document.querySelectorAll('header section ul li, header ul li, main header ul li');
    items.forEach(item => {
      const fullText = item.innerText.trim();
      if (!fullText) return;

      // Preferir el atributo title del span interno (suele tener el número exacto, sin abreviar)
      const titledSpan = item.querySelector('span[title]');
      const numberSource = (titledSpan && titledSpan.getAttribute('title')) || fullText;

      let key = null;
      if (STAT_KEYWORDS.followers.test(fullText)) key = 'followers';
      else if (STAT_KEYWORDS.following.test(fullText)) key = 'following';
      else if (STAT_KEYWORDS.posts.test(fullText)) key = 'posts';

      if (key && result[key] === undefined) {
        result[key] = parseNumber(numberSource);
      }
    });
    return result;
  }

  // ─── Extracción de stats desde el og:description (inglés y español) ──────
  function getStatsFromMeta(ogDesc) {
    if (!ogDesc) return null;

    // Captura hasta 3 segmentos del tipo "<numero+sufijo> <palabra>"
    const segments = ogDesc.match(/([\d.,]+\s*[KkMmBb]?)\s*([A-Za-zÁÉÍÓÚáéíóúñÑ]+)/g);
    if (!segments) return null;

    const result = {};
    segments.forEach(seg => {
      const m = seg.match(/([\d.,]+\s*[KkMmBb]?)\s*([A-Za-zÁÉÍÓÚáéíóúñÑ]+)/);
      if (!m) return;
      const numStr = m[1];
      const word = m[2];
      let key = null;
      if (STAT_KEYWORDS.followers.test(word)) key = 'followers';
      else if (STAT_KEYWORDS.following.test(word)) key = 'following';
      else if (STAT_KEYWORDS.posts.test(word)) key = 'posts';
      if (key && result[key] === undefined) {
        result[key] = parseNumber(numStr);
      }
    });

    return (result.followers !== undefined || result.following !== undefined || result.posts !== undefined)
      ? result
      : null;
  }

  // ─── Extracción del perfil ─────────────────────────────────────────────────
  function extractProfileData() {
    const data = {};

    // Username desde URL
    const urlMatch = window.location.pathname.match(/^\/([^\/]+)\/?$/);
    data.username = urlMatch ? urlMatch[1] : null;

    // Nombre completo
    data.fullName = getMeta('og:title') || getText('h2');

    // Descripción / bio
    const ogDesc = getMeta('og:description') || '';
    data.bio = ogDesc;

    // Intentar extraer stats: primero del header (DOM, más confiable y siempre
    // disponible en el idioma actual), luego del og:description como fallback.
    const headerStats = getStatsFromHeader();
    const metaStats = getStatsFromMeta(ogDesc);

    data.followers = (headerStats.followers !== undefined) ? headerStats.followers
                    : (metaStats && metaStats.followers !== undefined) ? metaStats.followers
                    : 0;
    data.following = (headerStats.following !== undefined) ? headerStats.following
                    : (metaStats && metaStats.following !== undefined) ? metaStats.following
                    : 0;
    data.posts = (headerStats.posts !== undefined) ? headerStats.posts
                    : (metaStats && metaStats.posts !== undefined) ? metaStats.posts
                    : 0;

    // Imagen de perfil
    data.profilePic = getMeta('og:image') || null;

    // URL del perfil
    data.profileUrl = `https://www.instagram.com/${data.username}/`;

    // Verificado (buscar ícono de verificación en DOM)
    data.isVerified = !!document.querySelector('svg[aria-label="Verified"]') ||
                      document.title.includes('✓') ||
                      !!document.querySelector('[title="Verified"]');

    // Link externo en bio (señal de negocio)
    data.externalLink = null;
    const linkEls = document.querySelectorAll('a[href*="://"]');
    linkEls.forEach(a => {
      if (a.href && !a.href.includes('instagram.com') && !a.href.includes('facebook.com')) {
        if (!data.externalLink) data.externalLink = a.href;
      }
    });

    // Categoría de cuenta (business/creator)
    data.category = null;
    const categoryEl = document.querySelector('div[data-testid="profile-category"]') ||
                       [...document.querySelectorAll('div')].find(d =>
                         d.innerText && /^(Artist|Musician|Public Figure|Local Business|Brand|Blogger|Coach|Creator|Entrepreneur|Consultant|Agency|Author|Photographer|Designer|Fitness)/i.test(d.innerText.trim()) &&
                         d.innerText.trim().length < 60
                       );
    if (categoryEl) data.category = categoryEl.innerText.trim();

    // Email en bio (indicador de business)
    const bioText = data.bio || '';
    const emailMatch = bioText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    data.emailInBio = emailMatch ? emailMatch[0] : null;

    // Timestamps
    data.scrapedAt = new Date().toISOString();

    return data;
  }

  // ─── Análisis de potencial de crecimiento ─────────────────────────────────
  function analyzeGrowthPotential(profile) {
    const signals = [];
    let score = 0;
    const maxScore = 100;

    const followers = profile.followers || 0;
    const following = profile.following || 0;
    const posts = profile.posts || 0;

    // 1. Sweet spot de seguidores (1K–100K = máximo potencial de conversión)
    if (followers >= 1000 && followers <= 10000) {
      score += 20;
      signals.push({ label: 'Micro-influencer (1K-10K)', type: 'positive', weight: 20 });
    } else if (followers > 10000 && followers <= 100000) {
      score += 15;
      signals.push({ label: 'Mid-tier (10K-100K)', type: 'positive', weight: 15 });
    } else if (followers < 1000 && followers >= 200) {
      score += 10;
      signals.push({ label: 'Cuenta emergente (200-1K)', type: 'positive', weight: 10 });
    } else if (followers > 100000) {
      score += 5;
      signals.push({ label: 'Gran cuenta (>100K)', type: 'neutral', weight: 5 });
    } else if (followers < 200) {
      signals.push({ label: 'Cuenta muy pequeña (<200)', type: 'negative', weight: 0 });
    }

    // 2. Ratio seguidores/seguidos (engagement health)
    const ratio = following > 0 ? followers / following : 0;
    if (ratio >= 0.5 && ratio <= 3) {
      score += 15;
      signals.push({ label: `Ratio sano (${ratio.toFixed(1)}x)`, type: 'positive', weight: 15 });
    } else if (ratio > 3 && ratio <= 10) {
      score += 20;
      signals.push({ label: `Buen ratio (${ratio.toFixed(1)}x)`, type: 'positive', weight: 20 });
    } else if (ratio > 10) {
      score += 25;
      signals.push({ label: `Ratio excelente (${ratio.toFixed(1)}x)`, type: 'positive', weight: 25 });
    } else {
      signals.push({ label: `Ratio bajo (${ratio.toFixed(1)}x) - posible spam`, type: 'negative', weight: 0 });
    }

    // 3. Actividad (posts)
    if (posts >= 12 && posts <= 500) {
      score += 15;
      signals.push({ label: `Cuenta activa (${posts} posts)`, type: 'positive', weight: 15 });
    } else if (posts > 500) {
      score += 10;
      signals.push({ label: `Muy activa (${posts} posts)`, type: 'positive', weight: 10 });
    } else if (posts < 12 && posts > 0) {
      score += 5;
      signals.push({ label: `Poca actividad (${posts} posts)`, type: 'warning', weight: 5 });
    }

    // 4. Señales de negocio
    if (profile.externalLink) {
      score += 15;
      signals.push({ label: 'Tiene link externo', type: 'positive', weight: 15 });
    }
    if (profile.emailInBio) {
      score += 10;
      signals.push({ label: 'Email en bio', type: 'positive', weight: 10 });
    }
    if (profile.category) {
      score += 5;
      signals.push({ label: `Categoría: ${profile.category}`, type: 'positive', weight: 5 });
    }

    // 5. Verificado
    if (profile.isVerified) {
      score -= 10;
      signals.push({ label: 'Cuenta verificada (ya tiene equipo)', type: 'negative', weight: -10 });
    }

    // Normalizar score
    score = Math.max(0, Math.min(maxScore, score));

    // Tier
    let tier, tierColor;
    if (score >= 75) { tier = 'HOT 🔥'; tierColor = '#ff4545'; }
    else if (score >= 55) { tier = 'WARM ✨'; tierColor = '#ff8c00'; }
    else if (score >= 35) { tier = 'LUKEWARM 👀'; tierColor = '#f0c040'; }
    else { tier = 'COLD ❄️'; tierColor = '#7fb3d3'; }

    return { score, tier, tierColor, signals };
  }

  // ─── Listener de mensajes desde popup ─────────────────────────────────────
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'EXTRACT_PROFILE') {
      const profile = extractProfileData();
      const analysis = analyzeGrowthPotential(profile);
      sendResponse({ success: true, profile, analysis });
    }

    if (request.action === 'EXTRACT_FOLLOWERS_LIST') {
      // Extrae usuarios visibles en la lista de seguidores/seguidos abierta
      const users = [];
      const followerItems = document.querySelectorAll('[role="dialog"] li, [role="dialog"] div[class*="x1dm5mii"]');
      followerItems.forEach(item => {
        const link = item.querySelector('a[href*="/"]');
        const nameEl = item.querySelector('span');
        if (link) {
          const href = link.getAttribute('href');
          const usernameMatch = href.match(/^\/([^\/]+)\/?$/);
          if (usernameMatch && usernameMatch[1] !== 'explore') {
            users.push({
              username: usernameMatch[1],
              displayName: nameEl ? nameEl.innerText.trim() : usernameMatch[1],
              profileUrl: `https://www.instagram.com/${usernameMatch[1]}/`
            });
          }
        }
      });
      sendResponse({ success: true, users: [...new Map(users.map(u => [u.username, u])).values()] });
    }

    return true; // keep channel open for async
  });

})();


