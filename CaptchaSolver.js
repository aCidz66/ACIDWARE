const https = require('https');
const { URLSearchParams } = require('url');

const API_HOST = 'https://2captcha.com';
const API_V2_HOST = 'https://api.2captcha.com';
const NOPECHA_API_HOST = 'https://api.nopecha.com/v1';
const IN_ENDPOINT = '/in.php';
const RES_ENDPOINT = '/res.php';
const DEFAULT_POLLING_INTERVAL = 5000;
const MAX_POLLING_ATTEMPTS = 60;
const USE_JSON = true; // use json=1 for structured responses

function postForm(url, params) {
  const body = new URLSearchParams(params).toString();
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => data += chunk);
      response.on('end', () => resolve(data.trim()));
    });

    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function postJson(url, obj) {
  const body = JSON.stringify(obj);
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => data += chunk);
      response.on('end', () => resolve(data.trim()));
    });

    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function postJsonAuth(url, obj, apiKey) {
  const body = JSON.stringify(obj);
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Basic ${apiKey}`,
      },
    }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => data += chunk);
      response.on('end', () => resolve(data.trim()));
    });

    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function getJsonAuth(url, params, apiKey) {
  const query = params ? ('?' + new URLSearchParams(params).toString()) : '';
  return new Promise((resolve, reject) => {
    const reqUrl = url + query;
    const request = https.get(reqUrl, { headers: { 'Authorization': `Basic ${apiKey}` } }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => data += chunk);
      response.on('end', () => resolve(data.trim()));
    });
    request.on('error', reject);
  });
}

function getText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => data += chunk);
      response.on('end', () => resolve(data.trim()));
    }).on('error', reject);
  });
}

function normalizeCaptchaPayload(captcha) {
  if (!captcha || !captcha.captcha_sitekey) {
    throw new Error('Invalid captcha payload');
  }
  // allow forcing the solver type via env var, e.g. TWO_CAPTCHA_FORCE_METHOD=recaptcha_v2
  const forced = (process.env.TWO_CAPTCHA_FORCE_METHOD || '').toLowerCase();
  const service = forced || (captcha.captcha_service || '').toLowerCase();
  if (service === 'hcaptcha') {
    return {
      method: 'hcaptcha',
      sitekey: captcha.captcha_sitekey,
      pageurl: 'https://discord.com/',
      invisible: 1,
      data: captcha.captcha_rqdata || captcha.captcha_rqtoken || undefined,
    };
  }
  if (service === 'recaptcha' || service === 'recaptcha_v2' || service === 'recaptcha_v3') {
    return {
      method: 'userrecaptcha',
      googlekey: captcha.captcha_sitekey,
      pageurl: 'https://discord.com/',
      invisible: 1,
      version: service === 'recaptcha_v3' ? 'v3' : undefined,
      data: captcha.captcha_rqdata || captcha.captcha_rqtoken || undefined,
    };
  }

  throw new Error(`Unsupported captcha service: ${captcha.captcha_service || 'unknown'}`);
}

async function submitCaptcha(apiKey, captcha) {
  // Prefer API v2 (createTask) JSON flow. Fall back to legacy in.php if needed.
  const useV2 = true;

  const MAX_SUBMIT_ATTEMPTS = Number(process.env.TWO_CAPTCHA_SUBMIT_RETRIES || 5);
  const BASE_BACKOFF_MS = Number(process.env.TWO_CAPTCHA_BACKOFF_MS || 2000);

  if (process.env.TWO_CAPTCHA_DEBUG) {
    const masked = apiKey ? `${apiKey.slice(0,4)}...${apiKey.slice(-4)}` : 'none';
    if (useV2) {
      console.log('[2captcha] createTask ->', `${API_V2_HOST}/createTask`, { key: masked, task: captcha });
    } else {
      console.log('[2captcha] submit ->', `${API_HOST}${IN_ENDPOINT}`, { key: masked, ...captcha });
    }
  }

  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_SUBMIT_ATTEMPTS; attempt++) {
    try {
      // If NOPECHA API key is provided, prefer using NopeCHA token endpoints
      const nopeKey = process.env.NOPECHA_API_KEY;
      if (nopeKey && captcha.method && (captcha.method === 'userrecaptcha' || captcha.method === 'hcaptcha')) {
        if (process.env.TWO_CAPTCHA_DEBUG) console.log('[nopecha] submit ->', captcha.method, captcha.sitekey || captcha.googlekey);
        // select endpoint
        const endpoint = captcha.method === 'userrecaptcha' ? '/token/recaptcha2' : '/token/hcaptcha';
        const body = (captcha.method === 'userrecaptcha') ? { sitekey: captcha.googlekey, url: captcha.pageurl, data: {} } : { sitekey: captcha.sitekey, url: captcha.pageurl, data: {} };
        if (captcha.data) {
          if (captcha.method === 'hcaptcha') body.data.rqdata = captcha.data;
          else body.data.s = captcha.data;
        }
        const raw = await postJsonAuth(`${NOPECHA_API_HOST}${endpoint}`, body, nopeKey);
        if (!raw) throw new Error('Empty response from NopeCHA create token');
        let parsed;
        try { parsed = JSON.parse(raw); } catch (e) { throw new Error(`Invalid JSON from NopeCHA submit: ${raw}`); }
        if (parsed && parsed.data) {
          if (process.env.TWO_CAPTCHA_DEBUG) console.log('[nopecha] job id ->', parsed.data);
          return String(parsed.data);
        }
        if (process.env.TWO_CAPTCHA_DEBUG) console.log('[nopecha] submit failed ->', raw);
        throw new Error(`NopeCHA submit failed: ${raw}`);
      }
      if (useV2) {
        // build createTask payload according to API v2
        const task = (() => {
          if (captcha.method === 'hcaptcha') {
            return {
              type: 'HCaptchaTaskProxyless',
              websiteURL: captcha.pageurl,
              websiteKey: captcha.sitekey,
              isInvisible: !!captcha.invisible,
            };
          }
          if (captcha.method === 'userrecaptcha') {
            if (captcha.version === 'v3') {
              return {
                type: 'RecaptchaV3TaskProxyless',
                websiteURL: captcha.pageurl,
                websiteKey: captcha.googlekey,
                minScore: captcha.minScore || 0.3,
              };
            }
            return {
              type: 'RecaptchaV2TaskProxyless',
              websiteURL: captcha.pageurl,
              websiteKey: captcha.googlekey,
              isInvisible: !!captcha.invisible,
            };
          }
          return null;
        })();

        if (!task) throw new Error('Unsupported captcha task for API v2');

        const raw = await postJson(`${API_V2_HOST}/createTask`, { clientKey: apiKey, task });
        if (!raw) throw new Error('Empty response from 2captcha createTask');
        let body;
        try { body = JSON.parse(raw); } catch (e) { throw new Error(`Invalid JSON from createTask: ${raw}`); }
        if (body && body.errorId === 0 && body.taskId) {
          if (process.env.TWO_CAPTCHA_DEBUG) console.log('[2captcha] createTask id ->', body.taskId);
          return String(body.taskId);
        }
        // transient server-side errors: treat some as retryable
        if (body && body.errorCode === 'ERROR_NO_SLOT_AVAILABLE') {
          lastErr = new Error(`2captcha createTask failed: ${JSON.stringify(body)}`);
          if (process.env.TWO_CAPTCHA_DEBUG) console.log(`[2captcha] createTask attempt ${attempt} got NO_SLOT_AVAILABLE, will retry`);
          await new Promise(r => setTimeout(r, BASE_BACKOFF_MS * attempt));
          continue;
        }
        if (process.env.TWO_CAPTCHA_DEBUG) console.log('[2captcha] createTask failed ->', JSON.stringify(body));
        throw new Error(`2captcha createTask failed: ${JSON.stringify(body)}`);
      }

      // legacy in.php fallback (kept for compatibility)
      const params = {
        key: apiKey,
        ...(USE_JSON ? { json: 1 } : { json: 0 }),
        ...captcha,
      };
      const raw = await postForm(`${API_HOST}${IN_ENDPOINT}`, params);
      if (!raw) throw new Error('Empty response from 2captcha');

      if (USE_JSON) {
        let body;
        try { body = JSON.parse(raw); } catch (e) { throw new Error(`Invalid JSON from 2captcha submit: ${raw}`); }
        if (body && (body.status === 1 || body.status === '1')) {
          if (process.env.TWO_CAPTCHA_DEBUG) console.log('[2captcha] submit id ->', body.request);
          return String(body.request);
        }
        if (body && body.request === 'ERROR_NO_SLOT_AVAILABLE') {
          lastErr = new Error(`2captcha submit failed: ${raw}`);
          if (process.env.TWO_CAPTCHA_DEBUG) console.log(`[2captcha] submit attempt ${attempt} got NO_SLOT_AVAILABLE, will retry`);
          await new Promise(r => setTimeout(r, BASE_BACKOFF_MS * attempt));
          continue;
        }
        if (process.env.TWO_CAPTCHA_DEBUG) console.log('[2captcha] submit failed ->', raw);
        throw new Error(`2captcha submit failed: ${raw}`);
      }

      const parts = raw.split('|');
      if (parts[0] === 'OK') return parts[1];
      if (parts[1] === 'ERROR_NO_SLOT_AVAILABLE') {
        lastErr = new Error(`2captcha submit failed: ${raw}`);
        if (process.env.TWO_CAPTCHA_DEBUG) console.log(`[2captcha] submit attempt ${attempt} got NO_SLOT_AVAILABLE, will retry`);
        await new Promise(r => setTimeout(r, BASE_BACKOFF_MS * attempt));
        continue;
      }
      throw new Error(`2captcha submit failed: ${raw}`);
    } catch (e) {
      lastErr = e;
      if (attempt === MAX_SUBMIT_ATTEMPTS) break;
      if (process.env.TWO_CAPTCHA_DEBUG) console.log(`[2captcha] submit attempt ${attempt} error ->`, e && e.message ? e.message : e);
      await new Promise(r => setTimeout(r, BASE_BACKOFF_MS * attempt));
    }
  }

  // Exhausted retries
  throw lastErr || new Error('2captcha submit failed: unknown error');
}

async function pollCaptcha(apiKey, captchaId) {
  // If NOPECHA API key present, poll NopeCHA token endpoints first
  const nopeKey = process.env.NOPECHA_API_KEY;
  if (nopeKey) {
    const tryEndpoints = ['/token/recaptcha2', '/token/hcaptcha', '/token/recaptcha3', '/token/turnstile'];
    for (let attempt = 0; attempt < MAX_POLLING_ATTEMPTS; attempt++) {
      for (const ep of tryEndpoints) {
        if (process.env.TWO_CAPTCHA_DEBUG) console.log('[nopecha] get ->', `${NOPECHA_API_HOST}${ep}`, { id: captchaId });
        try {
          const raw = await getJsonAuth(`${NOPECHA_API_HOST}${ep}`, { id: captchaId }, nopeKey);
          if (!raw) continue;
          let parsed;
          try { parsed = JSON.parse(raw); } catch (e) { if (process.env.TWO_CAPTCHA_DEBUG) console.log('[nopecha] invalid json ->', raw); continue; }
          if (parsed && parsed.data) {
            if (process.env.TWO_CAPTCHA_DEBUG) console.log('[nopecha] solved ->', parsed.data);
            return String(parsed.data);
          }
          // incomplete job or other recoverable codes: wait and retry
          if (parsed && parsed.code === 14) {
            await new Promise(r => setTimeout(r, 500));
            continue;
          }
        } catch (e) {
          if (process.env.TWO_CAPTCHA_DEBUG) console.log('[nopecha] poll error ->', e && e.message ? e.message : e);
          continue;
        }
      }
      await new Promise(r => setTimeout(r, DEFAULT_POLLING_INTERVAL));
    }
    throw new Error('NopeCHA solve timed out');
  }

  // Use API v2 polling (getTaskResult)
  for (let attempt = 0; attempt < MAX_POLLING_ATTEMPTS; attempt++) {
    const payload = { clientKey: apiKey, taskId: Number(captchaId) };
    const url = `${API_V2_HOST}/getTaskResult`;
    if (process.env.TWO_CAPTCHA_DEBUG) console.log('[2captcha] getTaskResult ->', url, payload);
    const raw = await postJson(url, payload);
    if (!raw) throw new Error('Empty response from 2captcha getTaskResult');
    let body;
    try { body = JSON.parse(raw); } catch (e) {
      if (process.env.TWO_CAPTCHA_DEBUG) console.log('[2captcha] invalid json getTaskResult ->', raw);
      throw new Error(`Invalid JSON from 2captcha getTaskResult: ${raw}`);
    }
    if (body.errorId && body.errorId !== 0) {
      if (body.errorCode === 'ERROR_CAPTCHA_UNSOLVABLE') throw new Error(`2captcha solve failed: ${JSON.stringify(body)}`);
      // treat other errors as terminal
      throw new Error(`2captcha getTaskResult error: ${JSON.stringify(body)}`);
    }
    if (body.status === 'processing') {
      await new Promise(resolve => setTimeout(resolve, DEFAULT_POLLING_INTERVAL));
      continue;
    }
    if (body.status !== 'ready') {
      throw new Error(`2captcha unexpected status: ${JSON.stringify(body)}`);
    }
    // extract token from solution object (varies by task type)
    const solution = body.solution || {};
    const token = solution.gRecaptchaResponse || solution['g-recaptcha-response'] || solution['h-captcha-response'] || solution.token || Object.values(solution)[0];
    if (!token) throw new Error(`2captcha returned empty solution: ${JSON.stringify(solution)}`);
    if (process.env.TWO_CAPTCHA_DEBUG) console.log('[2captcha] solved ->', token);
    return String(token);
  }

  throw new Error('2captcha solve timed out');
}

const createCaptchaSolver = (apiKey) => {
  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error('2captcha API key is required');
  }

  return async (captcha, userAgent) => {
    const normalized = normalizeCaptchaPayload(captcha);
    const captchaId = await submitCaptcha(apiKey, normalized);
    return pollCaptcha(apiKey, captchaId);
  };
};

module.exports = { createCaptchaSolver };
