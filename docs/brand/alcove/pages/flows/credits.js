/* 04 Flows / Buy credits: the exact quote, signing in the wallet, on its way, added once, and the receipt. */
(function () {
  var AL = window.AL, I = AL.icon, U = AL.ui, M = AL.marks;

  function creditsWin(state, extra) {
    var c = { welcome: '10,000', low: '412', empty: '0', pending: '412', added: '10,412', normal: '9,209' }[state] || '0';
    return U.win({ main: U.credits({ state: state }), sideOpts: { active: 'credits', credits: c }, overlay: extra && extra.overlay, toasts: extra && extra.toasts });
  }
  function quote() {
    return U.sheet({ width: 450, mark: M.mark(46), title: 'Buy 10,000 credits', text: 'These are the exact terms. Your wallet will ask you to sign this one purchase.',
      body: '<dl class="al-dl"><dt>You pay</dt><dd>10.00 USDC</dd><dt>Route fee</dt><dd>0.02 USDC</dd><dt>You get</dt><dd>10,000 credits</dd><dt>Paid</dt><dd>Privately, to Alcove</dd>' +
        '<dt>If it fails</dt><dd>Refunded to your wallet</dd><dt>This quote expires</dt><dd><span class="js-exp">5:00</span></dd></dl>',
      actions: '<span class="al-btn al-btn--lamp al-btn--block">' + I('wallet') + 'Sign in your wallet</span><span class="al-btn al-btn--quiet al-btn--block">Cancel</span>' });
  }
  function receipt() {
    return U.sheet({ width: 450, mark: '<span style="width:48px;height:48px;border-radius:50%;background:var(--al-positive-soft);color:var(--al-positive);display:inline-flex;align-items:center;justify-content:center">' + I('receipt') + '</span>',
      title: 'Receipt', text: 'Kept privately in your ledger. Only you can read it.',
      body: '<dl class="al-dl"><dt>Credits added</dt><dd>10,000</dd><dt>Paid</dt><dd>10.00 USDC</dd><dt>Route fee</dt><dd>0.02 USDC</dd><dt>Settled</dt><dd>2 Nov, 10:02</dd>' +
        '<dt>Purchase</dt><dd style="font-family:var(--al-font-mono);font-weight:500;font-size:12.5px">pk_7Qm2…xV9a</dd><dt>Added</dt><dd>Once</dd></dl>',
      actions: '<span class="al-btn al-btn--secondary al-btn--block">Done</span>' });
  }
  function countdown(el) {
    var s = AL.seq(el), e = el.querySelector('.js-exp');
    if (AL.reduce || !e) return s.stop;
    var p = e.textContent.split(':'), t = (+p[0]) * 60 + (+p[1]);
    function tick() {
      t = Math.max(0, t - 1);
      e.textContent = t > 0 ? Math.floor(t / 60) + ':' + ('0' + (t % 60)).slice(-2) : 'Expired';
      if (t > 0) s.at(1000, tick);
    }
    s.at(1000, tick);
    return s.stop;
  }

  AL.flowPage({
    id: 'flow-credits', order: 7, title: 'Free credits, then a pack', nav: 'Free credits, then a pack', file: 'credits', icon: 'credits', kicker: 'Buy credits', time: 'About 40 seconds',
    keywords: 'payment buy credits wallet sign intents pending receipt',
    lede: 'Everyone starts with 10,000 free credits and no wallet. Only when they run low does Alcove offer one fixed pack, paid privately from your own wallet. The exact terms come first, the wallet signs one purchase, and the credits arrive once, even if the confirmation arrives twice.',
    headline: 'From free credits to a private receipt',
    summary: 'Eight steps, from the welcome credits, through the wallet and back.',
    steps: [
      { title: 'Free to start', line: '10,000 credits, no wallet', dur: 5000, truth: ['Welcome credits added once per vault'],
        body: 'Every new vault gets 10,000 free credits: about 6 hours of call notes or 75 questions. No wallet, no card, nothing to sign. Calls themselves are always free.',
        screen: function () { return creditsWin('welcome'); } },
      { title: 'Running low', line: 'A nudge, not a wall', dur: 5000, truth: ['Calls never need credits'],
        body: 'When the free credits are nearly gone, a calm banner says how much is left and offers the pack. Calls keep working regardless; only notes and questions pause.',
        screen: function () { return creditsWin('low'); } },
      { title: 'The exact terms', line: 'Before signing', dur: 6000, truth: ['Fixed route and pack', 'Quote lifetime ≤ 5 min'],
        body: 'Buying shows the exact quote: what you pay, the fee, what you get, where a refund goes, and when the quote expires.',
        screen: function () { return creditsWin('low', { overlay: quote() }); }, enter: countdown },
      { title: 'Sign in your wallet', line: 'One purchase, nothing more', dur: 6400, truth: ['NEP-413 message', 'Local page on 127.0.0.1, one use'],
        body: 'Alcove opens a page on this device in your browser, and your wallet asks you to sign this one purchase. Signing gives no ongoing access.',
        screen: function () { return U.browser({ url: '127.0.0.1 · Alcove purchase', body: '<div style="height:650px">' + U.signPage({ exp: '4:48' }) + '</div>', extra: U.walletPopup(), label: 'Wallet signing page' }); },
        enter: countdown },
      { title: 'Signed', line: 'Back to Alcove', dur: 4400, truth: ['Signature checked against the offer'],
        body: 'Alcove checks the signature matches the exact offer before sending it. The page says you can close it, and it closes itself when done.',
        screen: function () { return U.browser({ url: '127.0.0.1 · Alcove purchase', body: '<div style="height:650px">' + U.signPage({ signed: true, exp: '4:41' }) + '</div>' }); } },
      { title: 'On its way', line: 'Pending, honestly', dur: 5400, truth: ['Pending purchase funds nothing'],
        body: 'Until the payment settles, it is On its way. Closing Alcove is fine; it picks up where it left off and never asks you to pay again.',
        screen: function () { return creditsWin('pending'); } },
      { title: 'Added once', line: '10,000 credits', dur: 5200, truth: ['Credited once per purchase'],
        body: 'When the payment settles, the credits arrive and count up once. A second confirmation changes nothing.',
        screen: function () { return creditsWin('added'); },
        enter: function (el) { var s = AL.seq(el); s.at(700, function () { s.count('.js-bal', 412, 10412, 1100); }); return s.stop; } },
      { title: 'The receipt', line: 'Private, in the ledger', dur: 5200, truth: ['Encrypted receipt'],
        body: 'Every change has a receipt in the ledger, readable only by you. It keeps every digit.',
        screen: function () { return creditsWin('added', { overlay: receipt() }); } }
    ],
    notes: [['Your wallet, your keys', ['Your wallet’s keys never enter Alcove; it only receives the signed purchase.', 'The signing request covers one purchase only, and expires with the quote.', 'Signing in Alcove never grants spending power.']],
      ['Counted once', ['Credits are added only for a confirmed payment, tied to the original purchase.', 'Repeated confirmations and restarts never add credits twice.', 'A pending or failed payment never pays for work.']],
      ['Credits are not money', ['They pay for answers and meeting notes in Alcove and can’t be sent anywhere.', 'The ledger separates available, set aside, used and on its way.', 'Receipts are encrypted; the database never sees amounts in plain text.']]]
  });
})();
