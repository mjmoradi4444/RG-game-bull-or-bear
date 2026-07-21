import { hashPassword } from './passwords';

/**
 * Generate an ADMIN_PASSWORD_HASH for the .env — run:
 *   npm run admin:hash -- 'your-strong-password'
 * (Never store the plaintext password anywhere; paste only the printed hash.)
 */
const password = process.argv[2];
if (!password) {
  console.error("Usage: npm run admin:hash -- '<password>'");
  process.exit(1);
}
console.log(hashPassword(password));
