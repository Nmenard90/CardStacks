/** Tests for lib/contact.ts (Node strips the types). Run: npm run test:lib */
import assert from 'node:assert/strict'
import test from 'node:test'
import { contactAction, contactProblem, contactUrl, facebookSearchUrl, formatContact, isFacebookLink, parseContact } from './contact.ts'

test('each way to be contacted checks its detail', () => {
  assert.equal(contactProblem('text', '(555) 123-4567'), null)
  assert.equal(contactProblem('call', '+44 20 7946 0958'), null)
  assert.match(contactProblem('text', 'call me'), /phone number/)
  assert.match(contactProblem('call', '12345'), /phone number/)
  assert.equal(contactProblem('email', 'jane@example.com'), null)
  assert.match(contactProblem('email', 'jane at example'), /email/)
  assert.match(contactProblem('email', 'jane@example.com?bcc=x@evil.test'), /email/)
  assert.equal(contactProblem('facebook', 'Jane Doe'), null, 'a name is enough for Facebook')
  assert.equal(contactProblem('other', 'Instagram @jane'), null)
  assert.match(contactProblem('facebook', '  '), /^Please fill in your name on Facebook\.$/)
})

test('the stored line round-trips and becomes a one-tap action for the seller', () => {
  assert.equal(formatContact('text', ' 555-123-4567 '), 'Text: 555-123-4567')
  assert.deepEqual(parseContact('Email: jane@example.com'), { method: 'email', value: 'jane@example.com' })
  assert.deepEqual(parseContact('ash@example.test'), { method: null, value: 'ash@example.test' })
  assert.equal(contactAction('Text: (555) 123-4567', 'Jane').href, 'sms:5551234567')
  assert.equal(contactAction('Call: +1 555 123 4567', 'Jane').href, 'tel:+15551234567')
  assert.equal(contactAction('Email: jane@example.com', 'Jane').href, 'mailto:jane@example.com')
  assert.equal(contactAction('Facebook: Jane Doe', 'J').href, 'https://www.facebook.com/search/people/?q=Jane%20Doe')
  assert.equal(contactAction('Facebook: facebook.com/jane.doe', 'J').href, 'https://facebook.com/jane.doe')
  assert.equal(contactAction('Other: Instagram @jane', 'J'), null)
  assert.equal(contactAction('Text: javascript:alert(1)', 'J'), null)
  // Older requests (no chosen way): their link, else a Facebook search for the name.
  assert.equal(contactAction('ash@example.test', 'Ash').href, 'https://www.facebook.com/search/people/?q=Ash')
  assert.equal(contactAction('m.me/ash', 'Ash').href, 'https://m.me/ash')
})

test('profile and Messenger links are recognised, with or without https://', () => {
  for (const c of ['https://www.facebook.com/jane.doe.123', 'facebook.com/profile.php?id=1000123', 'm.me/janedoe',
    'https://www.messenger.com/t/123456', 'fb.com/jane', 'Here: https://facebook.com/share/1AbC/ thanks'])
    assert.equal(isFacebookLink(c), true, c)
})

test('things that are not a usable Facebook link are not', () => {
  for (const c of ['Facebook', 'Facebook works Mercedes Canales', 'facebook.com', 'https://facebook.com/', '555-123-4567',
    'jane@example.com', 'https://example.com/jane', 'javascript:alert(1)'])
    assert.equal(isFacebookLink(c), false, c)
})

test('contactUrl only returns http(s) links', () => {
  assert.equal(contactUrl('m.me/jane')?.href, 'https://m.me/jane')
  assert.equal(contactUrl('Facebook'), null)
  assert.equal(contactUrl('javascript:alert(1)'), null)
})

test('people search link for a name', () => {
  assert.equal(facebookSearchUrl(' Lindsey Liu '), 'https://www.facebook.com/search/people/?q=Lindsey%20Liu')
})
