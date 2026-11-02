/* The Alcove mark, app icon, menu bar glyphs and illustrations. Colours come from tokens unless fixed artwork. */
(function () {
  var AL = window.AL, M = AL.marks, A = AL.art;
  var ARCH = 'M22 94V50A28 28 0 0 1 78 50V94Z';
  var ARCH_LINE = 'M26 92V50A24 24 0 0 1 74 50V92Z';

  function svg(vb, size, label, cls) {
    var a = label ? 'role="img" aria-label="' + AL.esc(label) + '"' : 'aria-hidden="true"';
    var w = size ? ' width="' + size + '" height="' + size + '"' : '';
    return '<svg class="' + (cls || 'al-mk') + '" viewBox="' + vb + '"' + w + ' ' + a + ' focusable="false">';
  }

  // The mark: an arch with a lamp inside. lit:false draws the closed state.
  M.mark = function (size, o) {
    o = o || {};
    var fg = o.fg || 'var(--al-accent)', lamp = o.lamp || 'var(--al-lamp)';
    var s = svg('0 0 100 100', size, o.label, 'al-mk ' + (o.cls || ''));
    s += '<path d="' + ARCH + '" style="fill:' + fg + '"/>';
    if (o.lit !== false) {
      if (size >= 28 && o.glow !== false) s += '<circle class="al-mk-glow" cx="50" cy="64" r="15" style="fill:' + lamp + ';opacity:.28"/>';
      s += '<circle class="al-mk-lamp" cx="50" cy="64" r="' + (size < 28 ? 9.5 : 7.5) + '" style="fill:' + lamp + '"/>';
    } else {
      s += '<circle cx="50" cy="64" r="' + (size < 28 ? 9.5 : 7.5) + '" style="fill:none;stroke:' + lamp + ';stroke-width:2.5;opacity:.55"/>';
    }
    return s + '</svg>';
  };

  // Lockups use the wordmark in Alegreya Sans 800, lowercase.
  M.lockup = function (size, o) {
    o = o || {};
    return '<span class="al-lockup" style="display:inline-flex;align-items:center;gap:' + Math.round(size * 0.28) + 'px">' +
      M.mark(size, o) + '<span class="al-wm" style="font-size:' + Math.round(size * 0.9) + 'px">alcove</span></span>';
  };
  M.stacked = function (size, o) {
    return '<span style="display:inline-flex;flex-direction:column;align-items:center;gap:' + Math.round(size * 0.16) + 'px">' +
      M.mark(size, o) + '<span class="al-wm" style="font-size:' + Math.round(size * 0.52) + 'px">alcove</span></span>';
  };

  // macOS app icon: a lit arch on a dusk squircle. Fixed artwork in both themes.
  M.appIcon = function (size) {
    var g1 = AL.uid('ag'), g2 = AL.uid('ag'), g3 = AL.uid('ag');
    return svg('0 0 100 100', size, 'Alcove app icon', 'al-mk al-appicon') +
      '<defs><linearGradient id="' + g1 + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#31456C"/><stop offset="1" stop-color="#161F33"/></linearGradient>' +
      '<radialGradient id="' + g2 + '" cx="50%" cy="70%" r="72%"><stop offset="0" stop-color="#FFF3D6"/><stop offset=".42" stop-color="#F6BA5F"/><stop offset="1" stop-color="#BF7526"/></radialGradient>' +
      '<radialGradient id="' + g3 + '" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#FFE3AE" stop-opacity=".55"/><stop offset="1" stop-color="#FFE3AE" stop-opacity="0"/></radialGradient></defs>' +
      '<rect width="100" height="100" rx="22.5" fill="url(#' + g1 + ')"/>' +
      '<ellipse cx="50" cy="78" rx="34" ry="7" fill="url(#' + g3 + ')"/>' +
      '<g transform="translate(19 14.5) scale(.62)"><path d="' + ARCH + '" fill="url(#' + g2 + ')"/></g>' +
      '<circle cx="50" cy="54.2" r="9" fill="#FFF6DE" opacity=".35"/><circle cx="50" cy="54.2" r="4.2" fill="#FFF9EC"/>' +
      '<rect x="27" y="72.8" width="46" height="3.4" rx="1.7" fill="#0C1322" opacity=".55"/>' +
      '<rect x=".5" y=".5" width="99" height="99" rx="22" fill="none" stroke="#fff" stroke-opacity=".08"/></svg>';
  };

  // Menu bar template glyphs: closed, lamp on, recording, needs you.
  M.glyph = function (state, size) {
    var s = svg('0 0 100 100', size || 18, null, 'al-mk al-glyph');
    s += '<path d="' + ARCH_LINE + '" style="fill:none;stroke:currentColor;stroke-width:8;stroke-linejoin:round"/>';
    if (state !== 'closed') s += '<circle cx="50" cy="62" r="11" style="fill:currentColor"/>';
    if (state === 'rec') s += '<circle cx="84" cy="16" r="14" style="fill:currentColor;stroke:var(--mb-bg,#E8E8EA);stroke-width:9;paint-order:stroke"/>';
    if (state === 'needs') s += '<circle cx="84" cy="16" r="19" style="fill:var(--mb-bg,#E8E8EA)"/><circle cx="84" cy="16" r="11" style="fill:none;stroke:currentColor;stroke-width:7"/>';
    return s + '</svg>';
  };

  // Construction drawing of the mark on its 100-unit grid.
  M.construction = function () {
    var g = '';
    for (var i = 0; i <= 100; i += 10) {
      g += '<path d="M' + i + ' 0V100M0 ' + i + 'H100" style="stroke:var(--al-line);stroke-width:.4"/>';
    }
    return svg('-6 -6 112 112', null, 'Construction of the Alcove mark on a 100-unit grid', 'al-mk al-construct') + g +
      '<circle cx="50" cy="50" r="28" style="fill:none;stroke:var(--al-info);stroke-width:.6;stroke-dasharray:2 2"/>' +
      '<path d="M22 50H78M50 22V94" style="stroke:var(--al-info);stroke-width:.6;stroke-dasharray:2 2"/>' +
      '<path class="draw" d="' + ARCH + '" style="fill:color-mix(in oklab, var(--al-accent) 14%, transparent);stroke:var(--al-accent);stroke-width:1.2;--len:260" data-beat-draw/>' +
      '<circle cx="50" cy="64" r="15" style="fill:none;stroke:var(--al-lamp);stroke-width:.7;stroke-dasharray:2 2"/>' +
      '<circle cx="50" cy="64" r="7.5" style="fill:var(--al-lamp);--b:3" data-beat-land/>' +
      '<text x="80" y="47" style="font:600 4.2px var(--al-font-ui);fill:var(--al-info)">r 28</text>' +
      '<text x="67" y="76" style="font:600 4.2px var(--al-font-ui);fill:var(--al-lamp-text)">lamp r 7.5</text>' +
      '<text x="30" y="99.5" style="font:600 4.2px var(--al-font-ui);fill:var(--al-ink-3)">56 wide, 72 tall</text></svg>';
  };

  // ---------- the cover scene: dusk, a niche, a desk lamp warming ----------
  A.cover = function () {
    var lit = AL.uid('cg'), pool = AL.uid('cg'), bulb = AL.uid('cg'), cone = AL.uid('cg');
    var books = [[262, 14, 46, '#3B5579'], [278, 11, 38, '#5D9077'], [291, 16, 50, '#8A5A2B'], [309, 12, 42, '#B13A32'],
      [323, 15, 36, '#2B3E5E'], [340, 11, 48, '#C9A35B'], [353, 14, 44, '#516A8E'], [369, 9, 34, '#7FAA94'],
      [380, 15, 50, '#5A3A1A'], [410, 13, 40, '#6E85A4'], [425, 17, 46, '#8C5E15'], [444, 12, 38, '#3C775B']];
    var b = books.map(function (k) {
      return '<rect x="' + k[0] + '" y="' + (214 - k[2]) + '" width="' + k[1] + '" height="' + k[2] + '" rx="1.5" fill="' + k[3] + '"/>';
    }).join('');
    var motes = '';
    for (var i = 0; i < 9; i++) {
      var x = 300 + ((i * 37) % 120), y = 290 - ((i * 23) % 70);
      motes += '<circle class="cv-mote" cx="' + x + '" cy="' + y + '" r="' + (1 + (i % 3) * 0.5) + '" fill="#FFE9C0" style="--dx:' + ((i % 2 ? 1 : -1) * (8 + i * 2)) + 'px;animation-delay:' + (2.2 + i * 0.7) + 's"/>';
    }
    return svg('150 4 420 436', null, 'A niche at dusk with a shelf of books and a desk lamp warming up', 'al-mk cv') +
      '<defs><radialGradient id="' + lit + '" cx="38%" cy="70%" r="75%"><stop offset="0" stop-color="#FFE9BE"/><stop offset=".35" stop-color="#EDB062"/><stop offset=".75" stop-color="#9A5E26"/><stop offset="1" stop-color="#4A3017"/></radialGradient>' +
      '<radialGradient id="' + pool + '" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#F6C27A" stop-opacity=".55"/><stop offset="1" stop-color="#F6C27A" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="' + bulb + '" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#FFF6DF" stop-opacity=".95"/><stop offset=".4" stop-color="#FFD58E" stop-opacity=".45"/><stop offset="1" stop-color="#FFD58E" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="' + cone + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE7B6" stop-opacity=".55"/><stop offset="1" stop-color="#FFE7B6" stop-opacity="0"/></linearGradient></defs>' +
      
      '<ellipse class="cv-pool" cx="352" cy="390" rx="250" ry="26" fill="url(#' + pool + ')"/>' +
      '<path d="M206 372V172A154 154 0 0 1 514 172V372Z" fill="#1A2537"/>' +
      '<path class="cv-dark" d="M222 372V178A138 138 0 0 1 498 178V372Z" fill="#141D2C"/>' +
      '<path class="cv-lit" d="M222 372V178A138 138 0 0 1 498 178V372Z" fill="url(#' + lit + ')"/>' +
      '<g class="cv-things">' + b + '<rect x="246" y="214" width="228" height="7" rx="2" fill="#4A2E14"/>' +
      '<rect x="238" y="300" width="244" height="9" rx="2" fill="#3E260F"/><rect x="250" y="309" width="8" height="63" fill="#33200C"/><rect x="462" y="309" width="8" height="63" fill="#33200C"/>' +
      '<path d="M392 300l52-4 4 4-54 3z" fill="#F4E6CC"/><path d="M396 297l46-3" stroke="#C9B48F" stroke-width="1"/>' +
      '<rect x="420" y="282" width="24" height="18" rx="2" fill="#2D4A72"/><rect x="424" y="276" width="20" height="8" rx="2" fill="#B13A32"/></g>' +
      '<g class="cv-lamp"><ellipse cx="300" cy="300" rx="18" ry="4" fill="#2A1A08"/><path d="M300 298l-10-46 26-26" fill="none" stroke="#2A1A08" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M302 214l30 8-8 22-34-4z" fill="#2D4A72"/></g>' +
      '<path class="cv-cone" d="M312 244L262 300H382Z" fill="url(#' + cone + ')"/>' +
      '<circle class="cv-bulb" cx="310" cy="244" r="56" fill="url(#' + bulb + ')"/>' +
      '<g class="cv-motes">' + motes + '</g>' +
      '<path class="cv-outline" d="M206 372V172A154 154 0 0 1 514 172V372" fill="none" stroke="#A9C4EC" stroke-opacity=".5" stroke-width="2" style="--len:900"/>' +
      '</svg>';
  };

  // Spot illustrations for empty and status states. They follow the theme.
  function niche(inner, o) {
    o = o || {};
    return svg('0 0 220 160', null, o.label, 'al-mk al-spot') +
      '<ellipse cx="110" cy="146" rx="78" ry="8" style="fill:var(--al-ink);opacity:.07"/>' +
      '<path d="M58 144V70A52 52 0 0 1 162 70V144Z" style="fill:' + (o.fill || 'var(--al-sunken)') + ';stroke:var(--al-line-strong);stroke-width:1.5"/>' +
      inner + '</svg>';
  }
  A.spot = function (kind) {
    var lamp = 'var(--al-lamp)';
    switch (kind) {
      case 'shelf':
        return niche('<rect x="72" y="106" width="76" height="4" rx="2" style="fill:var(--al-line-strong)"/>' +
          '<rect x="84" y="96" width="34" height="10" rx="2" style="fill:var(--al-accent);opacity:.75"/>' +
          '<rect x="88" y="88" width="26" height="8" rx="2" style="fill:var(--al-lamp);opacity:.85"/>' +
          '<circle cx="138" cy="40" r="13" style="fill:var(--al-raised);stroke:var(--al-line-strong)"/><path d="M138 34v12M132 40h12" style="stroke:var(--al-accent);stroke-width:2;stroke-linecap:round"/>', { label: 'An empty shelf' });
      case 'meetings':
        return niche('<rect x="102" y="78" width="16" height="30" rx="8" style="fill:var(--al-accent)"/><path d="M94 98a16 16 0 0 0 32 0M110 114v14M100 128h20" style="fill:none;stroke:var(--al-accent);stroke-width:3;stroke-linecap:round"/>' +
          '<path d="M134 84a14 14 0 0 1 0 20M142 78a24 24 0 0 1 0 32" style="fill:none;stroke:' + lamp + ';stroke-width:3;stroke-linecap:round" class="sp-pulse"/>', { label: 'A microphone in the niche' });
      case 'credits':
        return niche('<ellipse cx="110" cy="122" rx="26" ry="7" style="fill:var(--al-lamp)"/><path d="M84 122v-8c0 4 12 7 26 7s26-3 26-7v8c0 4-12 7-26 7s-26-3-26-7z" style="fill:var(--al-lamp-text)"/>' +
          '<ellipse cx="110" cy="108" rx="26" ry="7" style="fill:var(--al-lamp)"/><path d="M84 108v-8c0 4 12 7 26 7s26-3 26-7v8c0 4-12 7-26 7s-26-3-26-7z" style="fill:var(--al-lamp-text)"/>' +
          '<ellipse cx="110" cy="94" rx="26" ry="7" style="fill:#FFE2A8"/>', { label: 'A stack of credits' });
      case 'closed':
        return niche('<rect x="80" y="62" width="60" height="82" rx="3" style="fill:var(--al-accent)"/><path d="M80 62h60" style="stroke:var(--al-ink);opacity:.2"/>' +
          '<circle cx="128" cy="104" r="3.5" style="fill:var(--al-lamp)"/>', { label: 'The door is closed', fill: 'var(--al-accent)' });
      case 'check':
        return niche('<path d="M110 64l24 9v19c0 15-10 26-24 30-14-4-24-15-24-30V73z" style="fill:var(--al-raised);stroke:var(--al-accent);stroke-width:2.5;stroke-linejoin:round"/>' +
          '<path d="M100 93l7 7 14-15" style="fill:none;stroke:var(--al-positive);stroke-width:3.5;stroke-linecap:round;stroke-linejoin:round;--len:40" data-beat-draw/>' +
          '<circle cx="110" cy="93" r="42" class="sp-orbit" style="fill:none;stroke:' + lamp + ';stroke-width:2;stroke-dasharray:3 9;opacity:.8"/>', { label: 'The server is checked' });
      case 'ready':
        return niche('<circle cx="110" cy="104" r="34" style="fill:' + lamp + ';opacity:.22"/><circle cx="110" cy="104" r="12" style="fill:' + lamp + '"/>' +
          '<circle cx="148" cy="54" r="13" style="fill:var(--al-positive)"/><path d="M142 54l4 4 8-8" style="fill:none;stroke:#fff;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round"/>', { label: 'The lamp is on' });
      case 'unknown':
        return niche('<path d="M94 74h32M94 132h32M97 74v10l13 17 13-17V74M97 132v-10l13-17 13 17v10" style="fill:none;stroke:var(--al-unknown);stroke-width:3;stroke-linecap:round;stroke-linejoin:round"/>' +
          '<path d="M104 126h12l-6-8z" style="fill:var(--al-unknown);opacity:.6"/>', { label: 'Not sure yet' });
      case 'altered':
        return niche('<path d="M86 66h40l12 12v52H86z" style="fill:var(--al-raised);stroke:var(--al-line-strong);stroke-width:1.5"/><path d="M86 102l8-5 7 6 8-6 8 6 8-6 8 5 5-3" style="fill:none;stroke:var(--al-negative);stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round"/>' +
          '<path d="M96 80h26M96 88h20M96 114h26M96 122h16" style="stroke:var(--al-line-strong);stroke-width:2.5;stroke-linecap:round"/>', { label: 'A file that changed in storage' });
      case 'search':
        return niche('<circle cx="104" cy="96" r="18" style="fill:var(--al-raised);stroke:var(--al-accent);stroke-width:3.5"/><path d="M117 109l14 14" style="stroke:var(--al-accent);stroke-width:4;stroke-linecap:round"/>', { label: 'Nothing found' });
      default:
        return niche('<circle cx="110" cy="104" r="10" style="fill:' + lamp + '"/>');
    }
  };
})();
