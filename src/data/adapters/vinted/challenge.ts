/**
 * A page showing an anti-bot check (DataDome, hCaptcha, reCAPTCHA, Cloudflare): ERA never answers or works around it —
 * it stops everything, like a 403. Only the challenge itself counts (its frame), never a protection script that every
 * normal page loads.
 */
const CHALLENGE = [/^https:\/\/(geo\.)?captcha-delivery\.com\/(captcha|interstitial)/i, /^https:\/\/([a-z0-9-]+\.)?hcaptcha\.com\//i, /^https:\/\/www\.(google|recaptcha)\.(com|net)\/recaptcha\//i, /^https:\/\/challenges\.cloudflare\.com\//i];

export function isChallengeUrl(src: string | null | undefined): boolean {
  return !!src && CHALLENGE.some((re) => re.test(src));
}

/** The challenge frames on a page (their sources), if any. */
export function challengeOn(doc: Document): boolean {
  return Array.from(doc.querySelectorAll('iframe')).some((f) => isChallengeUrl(f.getAttribute('src')));
}
