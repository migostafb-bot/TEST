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

const CHECKOUT_URL = '{{ event.extra.checkout_url|default:organization.url }}';

const layout = (brand, { preheader, body }) => `<!doctype html>
<html lang="en">
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
<tr><td align="center" style="padding:32px 32px 16px;">
${brand.logoUrl
  ? `<img src="${brand.logoUrl}" alt="{{ organization.name }}" width="140" style="display:block;border:0;max-width:140px;height:auto;">`
  : `<span style="font:700 22px/1.2 Helvetica,Arial,sans-serif;color:${brand.text};">{{ organization.name }}</span>`}
</td></tr>
${body}
<tr><td style="padding:24px 32px 32px;border-top:1px solid #e5e7eb;">
<p style="margin:0 0 8px;font:400 12px/1.6 Helvetica,Arial,sans-serif;color:${brand.muted};">
Questions? Just reply to this email.
</p>
<p style="margin:0;font:400 12px/1.6 Helvetica,Arial,sans-serif;color:${brand.muted};">
{{ organization.name }} &middot; {{ organization.full_address }}<br>
<a href="{% unsubscribe %}" style="color:${brand.muted};">Unsubscribe</a>
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
<a href="${CHECKOUT_URL}" style="display:inline-block;padding:14px 32px;font:700 15px/1 Helvetica,Arial,sans-serif;color:#ffffff;text-decoration:none;border-radius:6px;">${label}</a>
</td></tr>
</table>`;

/** Renders the abandoned line items with image, title and price. */
const cart = (brand) => `
<tr><td style="padding:8px 32px 24px;">
{% for item in event.extra.line_items %}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
<tr>
<td width="88" valign="top">
<img src="{{ item.image_url }}" alt="{{ item.title }}" width="80" style="display:block;border:0;width:80px;height:auto;border-radius:6px;">
</td>
<td valign="top" style="padding-left:16px;">
<p style="margin:0 0 4px;font:600 15px/1.4 Helvetica,Arial,sans-serif;color:${brand.text};">{{ item.title }}</p>
<p style="margin:0;font:400 14px/1.4 Helvetica,Arial,sans-serif;color:${brand.muted};">{{ item.line_price|floatformat:2 }}</p>
</td>
</tr>
</table>
{% endfor %}
</td></tr>`;

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
const reminder = (store) => ({
  name: `[${store.name}] Abandoned Checkout 1 - Reminder`,
  subject: 'You left something behind',
  html: layout(store.brand, {
    preheader: 'Your cart is still saved - pick up where you left off.',
    body:
      heading(store.brand, 'Still thinking it over?') +
      paragraph(store.brand, 'We saved your cart, so you can finish whenever you are ready.') +
      cart(store.brand) +
      cta(store.brand, 'Return to checkout'),
  }),
});

/* --- Email 2: +24h. Handles the trust objection, not the price objection. --- */
const objections = (store) => ({
  name: `[${store.name}] Abandoned Checkout 2 - Why shop with us`,
  subject: 'Still available - and here is our promise',
  html: layout(store.brand, {
    preheader: 'Free returns, secure checkout, real people on support.',
    body:
      heading(store.brand, 'Your cart is still waiting') +
      paragraph(store.brand, 'If something gave you pause, here is what you should know:') +
      paragraph(
        store.brand,
        '<strong>Easy returns</strong> &middot; send it back if it is not right<br>' +
        '<strong>Secure checkout</strong> &middot; your payment details stay encrypted<br>' +
        '<strong>Real support</strong> &middot; reply to this email and a person answers'
      ) +
      cart(store.brand) +
      cta(store.brand, 'Complete my order'),
  }),
});

/* --- Email 3: +72h. Incentive last, so we never discount a sale we'd have won. --- */
const incentive = (store) => {
  const isShipping = store.incentive.type === 'free_shipping';
  const offer = isShipping ? 'free shipping' : 'a discount';
  return {
    name: `[${store.name}] Abandoned Checkout 3 - Incentive`,
    subject: isShipping ? 'Free shipping on your cart' : 'A little something off your cart',
    html: layout(store.brand, {
      preheader: `Use code ${store.incentive.code} before your cart expires.`,
      body:
        heading(store.brand, `Here is ${offer}`) +
        paragraph(
          store.brand,
          `Use code <strong>${store.incentive.code}</strong> at checkout. We are holding your cart a little longer.`
        ) +
        cart(store.brand) +
        cta(store.brand, 'Claim my offer'),
    }),
  };
};

export const buildTemplates = (store) => [reminder(store), objections(store), incentive(store)];
