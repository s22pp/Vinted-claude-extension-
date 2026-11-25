import { describe, expect, it } from 'vitest';
import { isChallengeUrl } from '@/data/adapters/vinted/challenge';

describe('an anti-bot check on a Vinted page stops everything', () => {
  it('the challenge frames: DataDome, hCaptcha, reCAPTCHA, Cloudflare', () => {
    expect(isChallengeUrl('https://geo.captcha-delivery.com/captcha/?initialCid=abc&cid=def')).toBe(true);
    expect(isChallengeUrl('https://geo.captcha-delivery.com/interstitial/?initialCid=abc')).toBe(true);
    expect(isChallengeUrl('https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html')).toBe(true);
    expect(isChallengeUrl('https://www.google.com/recaptcha/api2/anchor?k=abc')).toBe(true);
    expect(isChallengeUrl('https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile')).toBe(true);
  });

  it('never a protection script or an ordinary frame that normal pages load', () => {
    expect(isChallengeUrl('https://js.datadome.co/tags.js')).toBe(false);
    expect(isChallengeUrl('https://www.vinted.fr/items/123')).toBe(false);
    expect(isChallengeUrl('https://www.youtube.com/embed/xyz')).toBe(false);
    expect(isChallengeUrl(null)).toBe(false);
    expect(isChallengeUrl('')).toBe(false);
  });
});
