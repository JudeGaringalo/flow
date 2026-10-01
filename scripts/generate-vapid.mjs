
import { createECDH } from 'node:crypto';

const key = createECDH('prime256v1');

key.generateKeys();

console.log('NEXT_PUBLIC_VAPID_PUBLIC_KEY=' + key.getPublicKey().toString('base64url'));

console.log('VAPID_PRIVATE_KEY=' + key.getPrivateKey().toString('base64url'));

console.log(
  '\nAdd these two keys to Vercel and set VAPID_SUBJECT=mailto:your-actual-contact-address. Keep the private key server-only.'
);
