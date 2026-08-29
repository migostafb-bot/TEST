// Translates a competitor listing into French via the Claude API.
// The translation is faithful: same structure, same claims, same order.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const ListingSchema = z.object({
  title: z.string().describe("French product title"),
  descriptionHtml: z
    .string()
    .describe("French description as HTML, mirroring the source structure exactly"),
  handle: z.string().describe("URL slug: French title, lowercase, hyphenated, unaccented"),
  seoTitle: z.string().describe("French SEO title, 60 characters or fewer"),
  seoDescription: z.string().describe("French meta description, 155 characters or fewer"),
  productType: z.string().describe("French product category, e.g. 'Soin visage'"),
  tags: z.array(z.string()).describe("3-8 French tags for filtering"),
  claim_warnings: z
    .array(z.string())
    .describe(
      "Claims in the source that may breach French/EU rules on health or cosmetic claims. " +
        "Empty if none. Translate them faithfully anyway - this list is for the owner to review.",
    ),
  translator_notes: z
    .array(z.string())
    .describe("Anything the store owner should check: ambiguous terms, missing data, unit conversions."),
});

const SYSTEM = `You translate parapharmacy product listings from any language into French for a French online parapharmacy (parapharmafr.shop).

This is a TRANSLATION, not a rewrite. The French listing must mirror the source faithfully:
- Keep the same meaning, structure, order, headings and bullet points.
- Keep the same HTML markup: same <p>, <ul>, <li>, <h2>, <strong> structure as the source.
- Do not add, drop, embellish or soften any claim.
- Never translate: brand names, product line names, and INCI ingredient names (INCI is standardised Latin nomenclature - "Aqua", "Butyrospermum Parkii Butter" and so on stay exactly as written).
- Keep dosages, percentages, volumes and reference numbers exactly as they appear.
- Convert imperial units to metric, keeping the original in brackets when the source shows both.

Register: standard French parapharmacy language (peau sensible, application, soin, flacon, tube), vouvoiement, no tutoiement, no marketing slang.

If the source contains a strong medical claim (treats, cures, heals, guarantees, clinically proven), translate it faithfully AND list it in claim_warnings - French and EU rules on health and cosmetic claims are strict, and the store owner is legally responsible for the listing.

If the source description is empty or unusable, say so in translator_notes and build the description from the factual fields only. Never invent product information.`;

export async function translateListing(product) {
  const client = new Anthropic();

  const source = {
    title: product.title,
    brand: product.brand,
    ean: product.ean,
    category: product.category,
    description_html: product.description_html,
    ingredients: product.ingredients,
    usage: product.usage,
    source_url: product.source_url,
  };

  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 16000,
    system: SYSTEM,
    thinking: { type: "adaptive" },
    messages: [
      {
        role: "user",
        content:
          "Translate this product listing into French for the store.\n\n" +
          "```json\n" +
          JSON.stringify(source, null, 2) +
          "\n```",
      },
    ],
    output_config: { format: zodOutputFormat(ListingSchema) },
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`Translation declined: ${response.stop_details?.explanation ?? "no explanation given"}`);
  }
  if (!response.parsed_output) {
    throw new Error("Translation returned no structured output. Try again, or check the source page.");
  }

  return { ...response.parsed_output, usage: response.usage };
}
