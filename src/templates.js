/**
 * Abandoned-checkout email templates.
 *
 * Table-based layout on purpose: Outlook (Word rendering engine) ignores most
 * modern CSS, so nested tables with inline styles are the only thing that holds
 * up across Gmail, Outlook and Apple Mail.
 *
 * Liquid variables come from Klaviyo's Shopify "Started Checkout" event. Names
 * are verified against a real event payload in the account before deploy --
 * see `npm run verify`.
 */


/**
 * All user-facing wording, keyed by locale. Adding a language means adding a
 * block here -- the layout and Liquid stay shared.
 */
const COPY = {
  en: {
    lang: 'en',
    footerHelp: '${t.footerHelp}',
    unsubscribe: 'Unsubscribe',
    reminder: {
      subject: 'You left something behind',
      preheader: 'Your cart is still saved - pick up where you left off.',
      heading: 'Still thinking it over?',
      body: 'We saved your cart, so you can finish whenever you are ready.',
      cta: 'Return to checkout',
    },
    objections: {
      subject: 'Still available - and here is our promise',
      preheader: 'Free returns, secure checkout, real people on support.',
      heading: 'Your cart is still waiting',
      intro: 'If something gave you pause, here is what you should know:',
      points: [
        ['Easy returns', 'send it back if it is not right'],
        ['Secure checkout', 'your payment details stay encrypted'],
        ['Real support', 'reply to this email and a person answers'],
      ],
      cta: 'Complete my order',
    },
    incentive: {
      subjectShipping: 'Free shipping on your cart',
      subjectDiscount: 'A little something off your cart',
      preheader: (code) => `Use code ${code} before your cart expires.`,
      headingShipping: 'Here is free shipping',
      headingDiscount: 'Here is a discount',
      body: (code) => `Use code <strong>${code}</strong> at checkout. We are holding your cart a little longer.`,
      cta: 'Claim my offer',
    },
  },

  fr: {
    lang: 'fr',
    footerHelp: 'Une question ? Répondez simplement à cet e-mail.',
    unsubscribe: 'Se désabonner',
    reminder: {
      subject: 'Vous avez oublié quelque chose',
      preheader: 'Votre panier est toujours enregistré - reprenez où vous vous étiez arrêté.',
      heading: 'Vous hésitez encore ?',
      body: 'Nous avons gardé votre panier. Vous pouvez finaliser votre commande quand vous le souhaitez.',
      cta: 'Retourner au paiement',
    },
    objections: {
      subject: 'Toujours disponible - et voici notre engagement',
      preheader: 'Retours faciles, paiement sécurisé, un vrai service client.',
      heading: 'Votre panier vous attend toujours',
      intro: 'Si quelque chose vous a fait hésiter, voici ce qu\'il faut savoir :',
      points: [
        ['Retours faciles', 'renvoyez votre commande si elle ne vous convient pas'],
        ['Paiement sécurisé', 'vos données bancaires restent chiffrées'],
        ['Un vrai service client', 'répondez à cet e-mail, une personne vous répond'],
      ],
      cta: 'Finaliser ma commande',
    },
    incentive: {
      subjectShipping: 'La livraison est offerte sur votre panier',
      subjectDiscount: 'Une petite remise sur votre panier',
      preheader: (code) => `Utilisez le code ${code} avant l'expiration de votre panier.`,
      headingShipping: 'La livraison est offerte',
      headingDiscount: 'Voici votre remise',
      body: (code) => `Utilisez le code <strong>${code}</strong> lors du paiement. Nous gardons votre panier encore un peu.`,
      cta: 'Profiter de l\'offre',
    },
  },
};

const copyFor = (store) => COPY[store.locale] || COPY.en;

/**
 * Shopify sends `line_price` as a bare number, so the template has to add the
 * symbol. French convention puts it after the amount, separated by a
 * non-breaking space. The decimal separator stays a dot: Klaviyo's floatformat
 * has no locale-aware variant, so "65.80 €" is as close as the template gets.
 */
const CURRENCY = {
  EUR: { symbol: '&euro;', after: true },
  USD: { symbol: '$', after: false },
};

const price = (store, expr) => {
  const c = CURRENCY[store.currency] || CURRENCY.EUR;
  const amount = `{{ ${expr}|floatformat:2 }}`;
  return c.after ? `${amount}&nbsp;${c.symbol}` : `${c.symbol}${amount}`;
};

const CHECKOUT_URL = '{{ event.extra.checkout_url|default:organization.url }}';

/**
 * The unsubscribe link uses the `unsubscribe_link` tag, which yields a bare
 * URL. The plain `unsubscribe` tag renders an entire anchor element instead,
 * so putting it in an href nests one anchor inside another and leaks the raw
 * markup as visible text in the footer. Note both forms are also expanded
 * inside HTML comments, so neither can be mentioned in the emitted HTML.
 */
const layout = (brand, { preheader, body, t, name }) => `<!doctype html>
<html lang="${t.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<title>${preheader}</title>
</head>
<body style="margin:0;padding:0;background:${brand.background};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${brand.background};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:8px;">
<tr><td align="center" bgcolor="${brand.headerBackground}" style="padding:32px 32px 16px;background:${brand.headerBackground};border-radius:8px 8px 0 0;">
${brand.logoUrl
  ? `<img src="${brand.logoUrl}" alt="${name}" width="140" style="display:block;border:0;max-width:140px;height:auto;">`
  : `<span style="font:700 22px/1.2 Helvetica,Arial,sans-serif;color:${brand.text};">${name}</span>`}
</td></tr>
${body}
<tr><td style="padding:24px 32px 32px;border-top:1px solid #e5e7eb;">
<p style="margin:0 0 8px;font:400 12px/1.6 Helvetica,Arial,sans-serif;color:${brand.muted};">
${t.footerHelp}
</p>
<p style="margin:0;font:400 12px/1.6 Helvetica,Arial,sans-serif;color:${brand.muted};">
{{ organization.name }} &middot; {{ organization.full_address }}<br>
<a href="{% unsubscribe_link %}" style="color:${brand.muted};">${t.unsubscribe}</a>
</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

const button = (brand, label) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 0;">
<tr><td align="center" bgcolor="${brand.accent}" style="border-radius:6px;">
<a href="${CHECKOUT_URL}" style="display:inline-block;padding:14px 32px;font:700 15px/1 Helvetica,Arial,sans-serif;color:${brand.accentText};text-decoration:none;border-radius:6px;">${label}</a>
</td></tr>
</table>`;

/**
 * Renders the abandoned line items with image, title and price.
 *
 * The image lives at `product.images.0.src` -- the Shopify checkout payload has
 * no `image_url` on a line item, so addressing it that way renders a broken
 * image in every email. Verified against a real Started Checkout event.
 */
const cart = (store) => {
  const brand = store.brand;
  return `
<tr><td style="padding:8px 32px 24px;">
{% for item in event.extra.line_items %}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
<tr>
<td width="88" valign="top">
<img src="{{ item.product.images.0.src }}" alt="{{ item.title }}" width="80" style="display:block;border:0;width:80px;height:auto;border-radius:6px;">
</td>
<td valign="top" style="padding-left:16px;">
<p style="margin:0 0 4px;font:600 15px/1.4 Helvetica,Arial,sans-serif;color:${brand.text};">{{ item.title }}</p>
<p style="margin:0;font:400 14px/1.4 Helvetica,Arial,sans-serif;color:${brand.muted};">${price(store, 'item.line_price')}</p>
</td>
</tr>
</table>
{% endfor %}
</td></tr>`;
};

const heading = (brand, text) => `
<tr><td style="padding:8px 32px 0;">
<h1 style="margin:0 0 12px;font:700 24px/1.3 Helvetica,Arial,sans-serif;color:${brand.text};">${text}</h1>
</td></tr>`;

const paragraph = (brand, html) => `
<tr><td style="padding:0 32px;">
<p style="margin:0 0 16px;font:400 15px/1.6 Helvetica,Arial,sans-serif;color:${brand.text};">${html}</p>
</td></tr>`;

const cta = (brand, label) => `
<tr><td style="padding:0 32px 8px;">${button(brand, label)}</td></tr>`;

/* --- Email 1: +1h. No discount -- it protects margin and still converts best. --- */
const reminder = (store) => {
  const t = copyFor(store);
  return {
    name: `[${store.name}] Abandoned Checkout 1 - Reminder`,
    subject: t.reminder.subject,
    html: layout(store.brand, {
      t,
      name: store.displayName || store.name,
      preheader: t.reminder.preheader,
      body:
        heading(store.brand, t.reminder.heading) +
        paragraph(store.brand, t.reminder.body) +
        cart(store) +
        cta(store.brand, t.reminder.cta),
    }),
  };
};

/* --- Email 2: +24h. Handles the trust objection, not the price objection. --- */
const objections = (store) => {
  const t = copyFor(store);
  const points = t.objections.points
    .map(([label, detail]) => `<strong>${label}</strong> &middot; ${detail}`)
    .join('<br>');
  return {
    name: `[${store.name}] Abandoned Checkout 2 - Why shop with us`,
    subject: t.objections.subject,
    html: layout(store.brand, {
      t,
      name: store.displayName || store.name,
      preheader: t.objections.preheader,
      body:
        heading(store.brand, t.objections.heading) +
        paragraph(store.brand, t.objections.intro) +
        paragraph(store.brand, points) +
        cart(store) +
        cta(store.brand, t.objections.cta),
    }),
  };
};

/* --- Email 3: +72h. Incentive last, so we never discount a sale we'd have won. --- */
const incentive = (store) => {
  const t = copyFor(store);
  const isShipping = store.incentive.type === 'free_shipping';
  const { code } = store.incentive;
  return {
    name: `[${store.name}] Abandoned Checkout 3 - Incentive`,
    subject: isShipping ? t.incentive.subjectShipping : t.incentive.subjectDiscount,
    html: layout(store.brand, {
      t,
      name: store.displayName || store.name,
      preheader: t.incentive.preheader(code),
      body:
        heading(store.brand, isShipping ? t.incentive.headingShipping : t.incentive.headingDiscount) +
        paragraph(store.brand, t.incentive.body(code)) +
        cart(store) +
        cta(store.brand, t.incentive.cta),
    }),
  };
};

const buildTemplates = (store) => [reminder(store), objections(store), incentive(store)];
export { buildTemplates };
