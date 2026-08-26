/**
 * Minimal Klaviyo API client.
 * Docs: https://developers.klaviyo.com/en/reference/api_overview
 *
 * The API is date-versioned via the `revision` header. Bump API_REVISION only
 * after checking the changelog — older revisions keep working, so there is no
 * rush to move.
 */

const BASE_URL = 'https://a.klaviyo.com/api';
const API_REVISION = '2024-10-15';

class KlaviyoError extends Error {
  constructor(status, body) {
    const detail = body?.errors?.map((e) => e.detail).join('; ') || 'unknown error';
    super(`Klaviyo API ${status}: ${detail}`);
    this.status = status;
    this.body = body;
  }
}

class KlaviyoClient {
  constructor(apiKey) {
    if (!apiKey) throw new Error('Missing Klaviyo API key');
    this.apiKey = apiKey;
  }

  async request(method, path, payload) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Klaviyo-API-Key ${this.apiKey}`,
        revision: API_REVISION,
        accept: 'application/vnd.api+json',
        ...(payload ? { 'content-type': 'application/vnd.api+json' } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });

    const body = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) throw new KlaviyoError(res.status, body);
    return body;
  }

  listTemplates() {
    return this.request('GET', '/templates/');
  }

  createTemplate({ name, html, text }) {
    return this.request('POST', '/templates/', {
      data: { type: 'template', attributes: { name, html, text } },
    });
  }

  updateTemplate(id, { name, html, text }) {
    return this.request('PATCH', `/templates/${id}/`, {
      data: { type: 'template', id, attributes: { name, html, text } },
    });
  }

  /** Confirms the key works and reports what it can reach. */
  whoami() {
    return this.request('GET', '/accounts/');
  }
}

export { KlaviyoClient, KlaviyoError, API_REVISION };
