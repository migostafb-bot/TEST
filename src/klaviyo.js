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

/**
 * Flow creation shipped as a beta endpoint and is gated behind the `.pre`
 * revision, so it cannot ride on API_REVISION. Only the flow calls send this;
 * template deploys stay on the stable revision.
 */
const FLOWS_API_REVISION = '2024-10-15.pre';

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

  async request(method, path, payload, { revision = API_REVISION } = {}) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Klaviyo-API-Key ${this.apiKey}`,
        revision,
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

  /**
   * Create requires editor_type; update rejects it as an unknown field. The
   * asymmetry is in the API, not a mistake here -- keep the two payloads apart.
   */
  createTemplate({ name, html, text }) {
    return this.request('POST', '/templates/', {
      data: { type: 'template', attributes: { name, editor_type: 'CODE', html, text } },
    });
  }

  updateTemplate(id, { name, html, text }) {
    return this.request('PATCH', `/templates/${id}/`, {
      data: { type: 'template', id, attributes: { name, html, text } },
    });
  }

  listFlows() {
    return this.request('GET', '/flows/', null, { revision: FLOWS_API_REVISION });
  }

  /** The definition is not returned by default -- it has to be asked for. */
  getFlowDefinition(id) {
    return this.request('GET', `/flows/${id}/?additional-fields[flow]=definition`, null, {
      revision: FLOWS_API_REVISION,
    });
  }

  /**
   * Flows are created in Draft unless the definition says otherwise, so this
   * never puts a live send in front of a customer on its own.
   */
  createFlow({ name, definition }) {
    return this.request(
      'POST',
      '/flows/',
      { data: { type: 'flow', attributes: { name, definition } } },
      { revision: FLOWS_API_REVISION },
    );
  }

  /** Confirms the key works and reports what it can reach. */
  whoami() {
    return this.request('GET', '/accounts/');
  }
}

export { KlaviyoClient, KlaviyoError, API_REVISION, FLOWS_API_REVISION };
