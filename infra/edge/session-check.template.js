// CloudFront Function `session-check` (runtime cloudfront-js-2.0, viewer-request).
// GENERATED FILE: edit edge/session-core.js or edge/session-check.template.js and run
// `npm run build:edge` in infra/. The test suite fails if this file is stale.
import crypto from 'crypto';
import cf from 'cloudfront';

/*@@CORE@@*/

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest('base64url');
}

async function handler(event) {
  const request = event.request;
  const uri = request.uri;
  const cls = classifyPath(uri);
  if (cls.kind === 'bad') return denyResponse('bad', uri, request.headers);
  if (cls.kind === 'public') return request;
  let claims = null;
  const parsed = parseToken(sessionTokenFromRequest(request));
  if (parsed) {
    let key = null;
    try {
      key = await cf.kvs().get(KVS_KEY_PREFIX + parsed.kid);
    } catch (e) {
      key = null; // unknown kid (rotated out) or KVS error: treat as no session
    }
    claims = checkToken(parsed, key, hmac, Math.floor(Date.now() / 1000));
  }
  const decision = authorize(uri, claims);
  if (decision === 'allow') return request;
  return denyResponse(decision, uri, request.headers);
}
