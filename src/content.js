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
    str = str.replace(/,/g, '').trim();
    const match = str.match(/([\d.]+)\s*([KkMmBb]?)/);
    if (!match) return parseInt(str) || 0;
    let num = parseFloat(match[1]);
    const suffix = match[2].toUpperCase();
    if (suffix === 'K') num *= 1000;
    if (suffix === 'M') num *= 1000000;
    if (suffix === 'B') num *= 1000000000;
    return Math.round(num);
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

    // Intentar extraer stats desde el og:description
    // Formato típico: "X Followers, Y Following, Z Posts"
    const statsMatch = ogDesc.match(/([\d,.]+[KkMm]?)\s*Followers?[,\s]+([\d,.]+[KkMm]?)\s*Following[,\s]+([\d,.]+[KkMm]?)\s*Posts?/i);
    if (statsMatch) {
      data.followers = parseNumber(statsMatch[1]);
      data.following = parseNumber(statsMatch[2]);
      data.posts = parseNumber(statsMatch[3]);
    } else {
      // Fallback: buscar en el DOM
      const statEls = document.querySelectorAll('ul li');
      statEls.forEach(li => {
        const text = li.innerText;
        if (/followers/i.test(text)) data.followers = parseNumber(text);
        if (/following/i.test(text)) data.following = parseNumber(text);
        if (/posts/i.test(text)) data.posts = parseNumber(text);
      });
    }

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
