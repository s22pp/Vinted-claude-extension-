import { notePageProof } from '@/data/page-proofs';
import { REPLIES_ON_KEY, REPLY_KIT_KEY, type ReplyKit, conversationItem, kitReplies } from '@/intelligence/replies';

/**
 * "Réponses ERA" in Vinted's messaging (EXPERIMENTAL: depends on how Vinted builds its conversation page).
 * On a conversation (/inbox/…), a small button floats next to the message box; it lists your reply templates,
 * filled with what ERA knows of the listing the conversation links to. A click WRITES the text in the box —
 * nothing more: no request, no click on "Envoyer". You read it, complete what stays blank, and send it yourself.
 * The button lives outside Vinted's own page tree (fixed position), so Vinted's page is left as it is.
 */
export default defineContentScript({
  matches: ['https://www.vinted.fr/*'],
  runAt: 'document_idle',
  main() {
    let kit: ReplyKit | null = null;
    let on = true;
    let target: HTMLTextAreaElement | null = null;
    let timer: number | undefined;
    const Z = '2147483000';
    const FONT = 'system-ui,-apple-system,Segoe UI,sans-serif';
    const MONO = `'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace`;

    // Everything ERA adds here lives in one shadow root: Vinted's styles never reach it, ours never leak onto the page.
    const host = document.createElement('era-replies');
    host.style.cssText = `all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:${Z}`;
    const root = host.attachShadow({ mode: 'open' });
    const css = document.createElement('style');
    css.textContent = `
      .btn{position:fixed;display:none;height:26px;padding:0 10px;border:1px solid rgba(255,255,255,.16);border-radius:3px;background:#080C12;color:#F8FAFC;font:500 11.5px/24px ${MONO};cursor:pointer}
      .btn:hover{border-color:rgba(255,255,255,.4)}
      .chips{position:fixed;display:none;gap:6px}
      .chip{height:24px;padding:0 9px;border:1px solid rgba(255,255,255,.16);border-radius:2px;background:#080C12;color:#F8FAFC;font:500 11px/22px ${MONO};cursor:pointer}
      .chip:hover{background:#E2E8F0;color:#080C12}
      .menu{position:fixed;display:none;width:340px;max-height:60vh;overflow:auto;padding:6px;border-radius:4px;background:#0D131D;color:#F8FAFC;border:1px solid rgba(255,255,255,.14);font:13px/1.4 ${FONT}}
      .head{padding:6px 8px 8px;color:#94A3B8;font-size:12px}
      .item{display:block;width:100%;text-align:left;padding:8px;border:0;border-radius:3px;background:transparent;color:inherit;font:inherit;cursor:pointer}
      .item:hover{background:#131B29}
      .item b{display:block;font-weight:600}
      .item span{display:block;color:#94A3B8;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .foot{padding:8px;color:#8794A7;font:11px/1.4 ${MONO}}`;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn';
    button.setAttribute('data-era-replies', 'button');
    button.textContent = 'E · Réponses ERA';
    button.title = 'ERA remplit la zone de message ; vous relisez et envoyez vous-même (expérimental)';

    // Three quick replies right above the box: one click writes, never sends.
    const chips = document.createElement('div');
    chips.className = 'chips';
    chips.setAttribute('data-era-replies', 'chips');

    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.setAttribute('data-era-replies', 'menu');
    menu.setAttribute('role', 'menu');
    root.append(css, button, chips, menu);
    const CHIP_KEYS = ['OFFER_COUNTER', 'OFFER_DECLINE', 'SHIPPING'] as const;
    const CHIP_LABEL: Record<(typeof CHIP_KEYS)[number], string> = { OFFER_COUNTER: 'Contre-offre', OFFER_DECLINE: 'Prix ferme', SHIPPING: 'Envoi' };

    /** The message box of the open conversation: the last visible textarea on an /inbox/ page. */
    const findBox = (): HTMLTextAreaElement | null => {
      if (!location.pathname.startsWith('/inbox/')) return null;
      const all = [...document.querySelectorAll<HTMLTextAreaElement>('textarea')].filter((t) => !t.disabled && !t.readOnly && t.getClientRects().length > 0);
      return all[all.length - 1] ?? null;
    };
    /**
     * Listing ids the open conversation links to: the closest part of the page around the message box that links to
     * listings (the list of other conversations is further away), in page order.
     */
    const linkedIds = (box: HTMLElement | null) => {
      const idsIn = (root: ParentNode) => [...root.querySelectorAll<HTMLAnchorElement>('a[href*="/items/"]')].map((a) => /\/items\/(\d+)/.exec(a.getAttribute('href') ?? '')?.[1]).filter((x): x is string => !!x);
      // Up to the whole page at worst — where several of the seller's listings mean none is taken (conversationItem).
      for (let el = box?.parentElement ?? null; el; el = el.parentElement) {
        const ids = idsIn(el);
        if (ids.length) return ids;
      }
      return idsIn(document);
    };

    /** Writes like a person typing would (React reads the native setter and an insertText input event). */
    const write = (box: HTMLTextAreaElement, text: string) => {
      const next = box.value.trim() ? `${box.value.replace(/\s+$/, '')} ${text}` : text;
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      box.focus();
      if (set) set.call(box, next);
      else box.value = next;
      box.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
      box.dispatchEvent(new Event('change', { bubbles: true }));
      // A blank ERA could not fill: selected, so typing replaces it.
      const blank = next.indexOf('[à compléter]');
      if (blank >= 0) box.setSelectionRange(blank, blank + '[à compléter]'.length);
      else box.setSelectionRange(next.length, next.length);
    };

    const place = () => {
      if (!target || !target.isConnected) return hide();
      const r = target.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return hide(false);
      button.style.display = 'block';
      button.style.top = `${Math.max(4, r.top - 32)}px`;
      button.style.left = `${Math.max(4, r.right - button.offsetWidth)}px`;
      if (chips.childElementCount) {
        chips.style.display = 'flex';
        chips.style.top = `${Math.max(4, r.top - 31)}px`;
        chips.style.left = `${Math.max(4, r.left)}px`;
      }
      if (menu.style.display !== 'none') {
        const mh = Math.min(menu.scrollHeight, innerHeight * 0.6);
        menu.style.top = `${Math.max(4, r.top - 36 - mh)}px`;
        menu.style.left = `${Math.max(4, Math.min(innerWidth - 348, r.right - 340))}px`;
      }
    };
    const hide = (forget = true) => {
      button.style.display = 'none';
      chips.style.display = 'none';
      menu.style.display = 'none';
      if (forget) target = null;
    };

    const openMenu = () => {
      if (!kit || !target) return;
      const itemId = conversationItem(kit, linkedIds(findBox()));
      const name = itemId ? kit.items[itemId]?.title : null;
      menu.replaceChildren();
      const head = document.createElement('div');
      head.className = 'head';
      head.textContent = name ? `ERA · ${name}` : 'ERA · annonce non reconnue : les blancs restent à compléter';
      menu.appendChild(head);
      for (const r of kitReplies(kit, itemId)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        b.setAttribute('data-era-reply', r.key);
        b.className = 'item';
        const title = document.createElement('b');
        title.textContent = r.blanks ? `${r.label} · à compléter` : r.label;
        const preview = document.createElement('span');
        preview.textContent = r.text;
        b.append(title, preview);
        b.onclick = (e) => {
          e.preventDefault();
          if (target) {
            write(target, r.text);
            void notePageProof('vreplies');
          }
          menu.style.display = 'none';
        };
        menu.appendChild(b);
      }
      const foot = document.createElement('div');
      foot.className = 'foot';
      foot.textContent = 'Expérimental · ERA écrit, n’envoie jamais : relisez, puis envoyez vous-même.';
      menu.appendChild(foot);
      menu.style.display = 'block';
      place();
    };
    button.onclick = (e) => {
      e.preventDefault();
      if (menu.style.display === 'none') openMenu();
      else menu.style.display = 'none';
    };
    document.addEventListener('mousedown', (e) => {
      // Inside the shadow root, the event's target is the host: the composed path says where it really happened.
      const path = e.composedPath();
      if (menu.style.display !== 'none' && !path.includes(menu) && !path.includes(button)) menu.style.display = 'none';
    });
    /** The quick replies for the open conversation (the kit's own texts, filled with what ERA knows). */
    const fillChips = () => {
      chips.replaceChildren();
      if (!kit || !target) return;
      const itemId = conversationItem(kit, linkedIds(findBox()));
      const all = kitReplies(kit, itemId);
      for (const key of CHIP_KEYS) {
        const r = all.find((x) => x.key === key);
        if (!r) continue;
        const c = document.createElement('button');
        c.type = 'button';
        c.className = 'chip';
        c.setAttribute('data-era-chip', key);
        c.textContent = CHIP_LABEL[key];
        c.title = r.text;
        c.onclick = (e) => {
          e.preventDefault();
          if (target) {
            write(target, r.text);
            void notePageProof('vreplies');
          }
        };
        chips.appendChild(c);
      }
    };
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') menu.style.display = 'none';
    });

    const scan = () => {
      if (!on || !kit || !kit.templates.length) return hide();
      const box = findBox();
      if (!box) return hide();
      if (!host.isConnected) document.body.append(host);
      if (box !== target) {
        menu.style.display = 'none';
        target = box;
        fillChips();
      }
      place();
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(scan, 200);
    };

    const load = async () => {
      const got = (await browser.storage.local.get([REPLY_KIT_KEY, REPLIES_ON_KEY])) as Record<string, unknown>;
      const k = got[REPLY_KIT_KEY] as ReplyKit | undefined;
      kit = k && Array.isArray(k.templates) && typeof k.items === 'object' && k.items ? k : null;
      on = got[REPLIES_ON_KEY] !== false;
      // A new kit: the quick replies are drawn again for the open conversation.
      target = null;
      scan();
    };
    void load();
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (REPLY_KIT_KEY in changes || REPLIES_ON_KEY in changes)) void load();
    });
    // Vinted's app changes pages without reloading: look again after each change, and keep the button in place.
    // ERA's own button and menu never trigger another look.
    const mine = (n: Node) => n === host || host.contains(n);
    new MutationObserver((records) => {
      if (on && kit && records.some((r) => !mine(r.target) && [...r.addedNodes, ...r.removedNodes].some((n) => !mine(n)))) schedule();
    }).observe(document.documentElement, { childList: true, subtree: true });
    addEventListener('scroll', place, true);
    addEventListener('resize', place);
  },
});
