// Loads the generated CloudFront Function (edge/session-check.js) in an isolated V8 context
// that mimics the cloudfront-js-2.0 runtime surface we rely on:
//   - `crypto` module: createHmac/createHash with md5|sha1|sha256 and hex|base64|base64url digests only;
//   - `cloudfront` module: cf.kvs().get(key) -> Promise<string>, rejects when the key is missing;
//   - Buffer (runtime 2.0 built-in), console.log with a single argument, Date frozen at the start time.
// Anything else (process, require, setTimeout, fetch, ...) is absent, so accidental use throws.
import vm from 'node:vm';
import nodeCrypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const FUNCTION_PATH = join(here, '..', 'session-check.js');

const ALGS = ['md5', 'sha1', 'sha256'];
const ENCODINGS = ['hex', 'base64', 'base64url'];

function runtimeCrypto() {
  const wrap = (obj) => ({
    update(data) {
      obj.update(data);
      return this;
    },
    digest(enc) {
      if (enc !== undefined && !ENCODINGS.includes(enc)) throw new Error('unsupported digest encoding ' + enc);
      return obj.digest(enc);
    },
  });
  return {
    createHmac(alg, key) {
      if (!ALGS.includes(alg)) throw new Error('unsupported hmac alg ' + alg);
      return wrap(nodeCrypto.createHmac(alg, key));
    },
    createHash(alg) {
      if (!ALGS.includes(alg)) throw new Error('unsupported hash alg ' + alg);
      return wrap(nodeCrypto.createHash(alg));
    },
  };
}

export function loadFunction({ kvs = {}, nowMs = Date.now() } = {}) {
  const src = readFileSync(FUNCTION_PATH, 'utf8');
  const importRe = /^import (\w+) from '([\w-]+)';$/gm;
  const imports = [...src.matchAll(importRe)].map((m) => [m[1], m[2]]);
  const body = src.replace(importRe, '');
  const modules = {
    crypto: runtimeCrypto(),
    cloudfront: {
      kvs() {
        return {
          async get(key, opts) {
            if (opts && opts.format && opts.format !== 'string') throw new Error('format not mocked');
            if (!Object.prototype.hasOwnProperty.call(kvs, key)) throw new Error('KeyNotFound');
            return kvs[key];
          },
        };
      },
    },
  };
  const logs = [];
  const FrozenDate = function () {
    return new Date(nowMs);
  };
  FrozenDate.now = () => nowMs;
  const ctx = {
    Buffer,
    TextEncoder,
    TextDecoder,
    Date: FrozenDate,
    console: {
      log(msg) {
        if (arguments.length > 1) throw new Error('CloudFront console.log takes one argument');
        logs.push(String(msg));
      },
    },
  };
  for (const [name, mod] of imports) {
    if (!(mod in modules)) throw new Error('module not available in runtime: ' + mod);
    ctx[name] = modules[mod];
  }
  vm.createContext(ctx);
  vm.runInContext(body + '\nglobalThis.__handler = handler;', ctx, { filename: 'session-check.js' });
  return { handler: ctx.__handler, logs };
}

// Builds a CloudFront Functions viewer-request event.
export function cfEvent(uri, { cookie, headers = {} } = {}) {
  const h = {};
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = { value: v };
  const cookies = {};
  if (cookie) {
    h.cookie = { value: cookie };
    for (const part of cookie.split(';')) {
      const i = part.indexOf('=');
      if (i > 0) cookies[part.slice(0, i).trim()] = { value: part.slice(i + 1).trim() };
    }
  }
  return {
    version: '1.0',
    context: { eventType: 'viewer-request' },
    viewer: { ip: '198.51.100.10' },
    request: { method: 'GET', uri, querystring: {}, headers: h, cookies },
  };
}
