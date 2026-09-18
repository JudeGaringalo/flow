// No npm dependencies: generate a P-256 VAPID pair using Node's built-in crypto.
import { createECDH, randomBytes } from 'node:crypto';

const key = createECDH('prime256v1');

key.generateKeys();

console.log('NEXT_PUBLIC_VAPID_PUBLIC_KEY=' + key.getPublicKey().toString('base64url'));

console.log('VAPID_PRIVATE_KEY=' + key.getPrivateKey().toString('base64url'));

console.log('PUSH_WORKER_SECRET=' + randomBytes(32).toString('hex'));

console.log(
  '\nAdd these values to .env.local and Vercel environment variables. Only NEXT_PUBLIC_VAPID_PUBLIC_KEY is public; all other values must stay server-only. Also set VAPID_SUBJECT=mailto:your-actual-contact-address.'
);
