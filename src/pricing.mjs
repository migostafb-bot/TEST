// Turns a competitor's price into this store's price, by a rule set in .env,
// so imports are priced the same way every time instead of case by case.
//
//   SHOPIFY_FX_<CUR>_EUR   exchange rate, e.g. SHOPIFY_FX_USD_EUR=0.92
//   SHOPIFY_MARGIN_PERCENT margin added on top, e.g. 40
//   SHOPIFY_PRICE_ENDING   price ending to round to, e.g. 0.90

const DEFAULT_RATES = { USD: 0.92, GBP: 1.17, CAD: 0.68, AUD: 0.61, CHF: 1.07, EUR: 1 };

export function exchangeRate(currency) {
  const code = String(currency || "EUR").toUpperCase();
  const configured = process.env[`SHOPIFY_FX_${code}_EUR`];
  if (configured && Number(configured) > 0) return Number(configured);
  if (DEFAULT_RATES[code]) return DEFAULT_RATES[code];
  throw new Error(
    `No exchange rate for ${code}. Set SHOPIFY_FX_${code}_EUR in .env, e.g. SHOPIFY_FX_${code}_EUR=0.9`,
  );
}

// Rounds up to the next price ending (14.23 with ending .90 becomes 14.90),
// which is how retail prices are normally set.
export function roundToEnding(amount, ending) {
  if (!(ending >= 0) || ending >= 1) return Math.round(amount * 100) / 100;
  const whole = Math.floor(amount);
  const candidate = whole + ending;
  return Number((candidate >= amount ? candidate : whole + 1 + ending).toFixed(2));
}

// A fixed price ladder, when the store prices by tier rather than from the
// competitor: SHOPIFY_FIXED_TIERS="32.90,49.90,59.90".
export function fixedTiers() {
  const raw = process.env.SHOPIFY_FIXED_TIERS;
  if (!raw) return null;
  const prices = raw
    .split(",")
    .map((value) => Number(String(value).trim()))
    .filter((value) => value > 0);
  return prices.length ? prices.map((price) => price.toFixed(2)) : null;
}

export function computePrice(referencePrice, currency) {
  const fixed = fixedTiers();
  if (fixed) {
    return {
      fixed_ladder: true,
      tiers: fixed.map((price, index) => ({
        quantity: index + 1,
        price,
        display: `${price.replace(".", ",")} €`,
      })),
      price: fixed[0],
      display: `${fixed[0].replace(".", ",")} €`,
      note: "Store prices are fixed by tier; the competitor's price is not used.",
    };
  }

  const source = Number(referencePrice);
  if (!(source > 0)) throw new Error(`Cannot price from "${referencePrice}".`);

  const margin = Number(process.env.SHOPIFY_MARGIN_PERCENT ?? 0);
  const ending = process.env.SHOPIFY_PRICE_ENDING === "" ? NaN : Number(process.env.SHOPIFY_PRICE_ENDING ?? 0.9);

  const euros = source * exchangeRate(currency);
  const withMargin = euros * (1 + margin / 100);
  const price = Number.isNaN(ending) ? Math.round(withMargin * 100) / 100 : roundToEnding(withMargin, ending);

  return {
    price: price.toFixed(2),
    display: `${price.toFixed(2).replace(".", ",")} €`,
    from: `${source} ${String(currency || "").toUpperCase()}`.trim(),
    rate: exchangeRate(currency),
    margin_percent: margin,
  };
}
