import { writeFileSync } from 'node:fs';

// Private material is written directly to an ignored local file, never stdout.
const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const privateJwk = await crypto.subtle.exportKey('jwk', keys.privateKey);
const publicBytes = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
const publicKey = Buffer.from(publicBytes).toString('base64url');
writeFileSync(new URL('../.vapid-private-key', import.meta.url), privateJwk.d + '\n', { flag: 'wx', mode: 0o600 });
writeFileSync(new URL('../.vapid-public-key', import.meta.url), publicKey + '\n', { flag: 'wx' });
process.stdout.write('Public VAPID key: ' + publicKey + '\nPrivate key saved to ignored .vapid-private-key. Keep it private and preserve it across deployments.\n');
