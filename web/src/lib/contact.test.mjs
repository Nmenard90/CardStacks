/** Tests for lib/contact.ts (Node strips the types). Run: npm run test:lib */
import assert from 'node:assert/strict'
import test from 'node:test'
import { contactUrl, facebookSearchUrl, isFacebookLink } from './contact.ts'

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
