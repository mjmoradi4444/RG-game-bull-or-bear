import { strict as assert } from 'node:assert';
import { isValidEmail, cleanEmail, normalizeEmail, suggestEmail } from './email';

/** Unit tests for email validation/normalization — run with `tsx src/_emailtest.ts`. */

// Valid shapes.
assert.ok(isValidEmail('a@b.co'));
assert.ok(isValidEmail('User.Name+tag@Gmail.com'));
assert.ok(isValidEmail('reza_1990@company.co.uk'));

// Invalid shapes.
assert.ok(!isValidEmail(''));
assert.ok(!isValidEmail('nope'));
assert.ok(!isValidEmail('a@b'));
assert.ok(!isValidEmail('a@@b.com'));
assert.ok(!isValidEmail('a b@c.com'));
assert.ok(!isValidEmail('a@b.c')); // 1-char TLD
assert.ok(!isValidEmail('a@b.c0m')); // digit in TLD
assert.ok(!isValidEmail(`${'x'.repeat(250)}@b.com`)); // too long

// cleanEmail = trim + lowercase, address kept as typed (dots preserved).
assert.equal(cleanEmail('  Reza@Gmail.COM '), 'reza@gmail.com');
assert.equal(cleanEmail('First.Last@Company.com'), 'first.last@company.com');

// normalizeEmail collapses gmail dots + plus-tags for duplicate detection only.
assert.equal(normalizeEmail('re.za+promo@gmail.com'), 'reza@gmail.com');
assert.equal(normalizeEmail('re.za@googlemail.com'), 'reza@googlemail.com');
// Non-gmail keeps dots (they can be significant elsewhere), still strips +tag.
assert.equal(normalizeEmail('first.last+x@company.com'), 'first.last@company.com');
// Two visually different gmail addresses normalize equal → dedupe catches them.
assert.equal(normalizeEmail('r.e.z.a@gmail.com'), normalizeEmail('reza@gmail.com'));

// Typo suggestions.
assert.equal(suggestEmail('reza@gmial.com'), 'reza@gmail.com');
assert.equal(suggestEmail('sara@gmail.co'), 'sara@gmail.com');
assert.equal(suggestEmail('ok@gmail.com'), null);
assert.equal(suggestEmail('nope'), null);

console.log('email: all tests passed');
