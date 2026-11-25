import { describe, expect, it } from 'vitest';
import { identity, isVintedImage, mergeProfile, profileFromNextData, profileFromUser, validProfile } from '@/intelligence/profile';

// Test data only: a made-up account, not a real Vinted user.
const user = {
  user: {
    id: 100000001,
    login: 'boutique-test',
    photo: {
      url: 'https://images1.vinted.net/t/avatar/f800/a.jpeg',
      thumbnails: [
        { type: 'thumb20', url: 'https://images1.vinted.net/t/avatar/20/a.jpeg' },
        { type: 'thumb100', url: 'https://images1.vinted.net/t/avatar/100/a.jpeg' },
        { type: 'thumb310', url: 'https://images1.vinted.net/t/avatar/310/a.jpeg' },
      ],
    },
  },
};

describe('the seller’s Vinted identity', () => {
  it('login and the avatar near 100 px from users/current; Vinted’s image servers only', () => {
    expect(profileFromUser(user)).toEqual({ username: 'boutique-test', avatarUrl: 'https://images1.vinted.net/t/avatar/100/a.jpeg' });
    expect(profileFromUser({ user: { login: 'x y' } })).toBeNull();
    expect(profileFromUser({ user: { login: 'shop', photo: { url: 'https://evil.example/a.jpg' } } })).toEqual({ username: 'shop', avatarUrl: null });
    expect(isVintedImage('http://images1.vinted.net/a.jpg')).toBe(false);
    expect(isVintedImage('https://vinted.net.evil.example/a.jpg')).toBe(false);
  });

  it('from __NEXT_DATA__: only the user marked as the current one', () => {
    expect(profileFromNextData({ props: { pageProps: { seller: { login: 'someone-else' }, currentUser: user.user } } })).toMatchObject({ username: 'boutique-test' });
    expect(profileFromNextData({ props: { pageProps: { seller: { login: 'someone-else' } } } })).toBeNull();
  });

  it('fallback: nothing synced shows ERA, waiting for an import; synced shows the account', () => {
    expect(identity(null)).toEqual({ name: 'ERA', avatar: null, synced: false });
    const p = mergeProfile(null, { username: 'boutique-test', avatarUrl: null }, 1);
    expect(identity(p)).toEqual({ name: 'boutique-test', avatar: null, synced: true });
  });

  it('switching account replaces everything; the same account keeps its cached image unless the avatar changed', () => {
    const a = { username: 'boutique-test', avatarUrl: 'https://images1.vinted.net/a.jpg', avatarData: 'data:image/jpeg;base64,AAAA', updatedAt: 1 };
    expect(mergeProfile(a, { username: 'boutique-test', avatarUrl: 'https://images1.vinted.net/a.jpg' }, 2)?.avatarData).toBe('data:image/jpeg;base64,AAAA');
    expect(mergeProfile(a, { username: 'boutique-test', avatarUrl: 'https://images1.vinted.net/b.jpg' }, 2)?.avatarData).toBeNull();
    expect(mergeProfile(a, { username: 'autre-compte', avatarUrl: null }, 2)).toEqual({ username: 'autre-compte', avatarUrl: null, avatarData: null, updatedAt: 2 });
    // A header avatar with no login: only for the account already known.
    expect(mergeProfile(a, { username: null, avatarUrl: 'https://images1.vinted.net/c.jpg' }, 3)).toMatchObject({ username: 'boutique-test', avatarUrl: 'https://images1.vinted.net/c.jpg', avatarData: null });
    expect(mergeProfile(null, { username: null, avatarUrl: 'https://images1.vinted.net/c.jpg' }, 3)).toBeNull();
  });

  it('what is stored is validated before use', () => {
    expect(validProfile({ username: 'ok', avatarUrl: 'javascript:alert(1)', avatarData: 'data:text/html;base64,AA', updatedAt: 1 })).toEqual({ username: 'ok', avatarUrl: null, avatarData: null, updatedAt: 1 });
    expect(validProfile({ username: '<b>', updatedAt: 1 })).toBeNull();
    expect(validProfile(null)).toBeNull();
  });
});
