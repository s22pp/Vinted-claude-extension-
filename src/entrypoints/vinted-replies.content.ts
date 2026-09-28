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

    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('data-era-replies', 'button');
    button.textContent = 'Réponses ERA';
    button.title = 'ERA remplit la zone de message ; vous relisez et envoyez vous-même (expérimental)';
    button.style.cssText = `position:fixed;z-index:${Z};display:none;padding:4px 10px;border:0;border-radius:999px;background:#4338ca;color:#fff;font:600 12px/1.4 ${FONT};box-shadow:0 1px 4px rgba(0,0,0,.25);cursor:pointer`;

    const menu = document.createElement('div');
    menu.setAttribute('data-era-replies', 'menu');
    menu.setAttribute('role', 'menu');
    menu.style.cssText = `position:fixed;z-index:${Z};display:none;width:340px;max-height:60vh;overflow:auto;padding:6px;border-radius:12px;background:#fff;color:#111;border:1px solid #e5e7eb;box-shadow:0 8px 28px rgba(0,0,0,.18);font:13px/1.4 ${FONT}`;

    /** The message box of the open conversation: the last visible textarea on an /inbox/ page. */
    const findBox = (): HTMLTextAreaElement | null => {
      if (!location.pathname.startsWith('/inbox/')) return null;
      const all = [...document.querySelectorAll<HTMLTextAreaElement>('textarea')].filter((t) => !t.disabled && !t.readOnly && t.getClientRects().length > 0);
      return all[all.length - 1] ?? null;
    };
    /** Listing ids the conversation page links to, in page order. */
    const linkedIds = () => [...document.querySelectorAll<HTMLAnchorElement>('a[href*="/items/"]')].map((a) => /\/items\/(\d+)/.exec(a.getAttribute('href') ?? '')?.[1]).filter((x): x is string => !!x);

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
      button.style.top = `${Math.max(4, r.top - 30)}px`;
      button.style.left = `${Math.max(4, r.right - button.offsetWidth)}px`;
      if (menu.style.display !== 'none') {
        const mh = Math.min(menu.scrollHeight, innerHeight * 0.6);
        menu.style.top = `${Math.max(4, r.top - 36 - mh)}px`;
        menu.style.left = `${Math.max(4, Math.min(innerWidth - 348, r.right - 340))}px`;
      }
    };
    const hide = (forget = true) => {
      button.style.display = 'none';
      menu.style.display = 'none';
      if (forget) target = null;
    };

    const openMenu = () => {
      if (!kit || !target) return;
      const itemId = conversationItem(kit, linkedIds());
      const name = itemId ? kit.items[itemId]?.title : null;
      menu.replaceChildren();
      const head = document.createElement('div');
      head.style.cssText = 'padding:6px 8px 8px;color:#6b7280;font-size:12px';
      head.textContent = name ? `ERA · ${name}` : 'ERA · annonce non reconnue : les blancs restent à compléter';
      menu.appendChild(head);
      for (const r of kitReplies(kit, itemId)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        b.setAttribute('data-era-reply', r.key);
        b.style.cssText = `display:block;width:100%;text-align:left;padding:8px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;cursor:pointer`;
        b.onmouseenter = () => (b.style.background = '#f3f4f6');
        b.onmouseleave = () => (b.style.background = 'transparent');
        const title = document.createElement('div');
        title.style.fontWeight = '600';
        title.textContent = r.blanks ? `${r.label} · à compléter` : r.label;
        const preview = document.createElement('div');
        preview.style.cssText = 'color:#6b7280;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        preview.textContent = r.text;
        b.append(title, preview);
        b.onclick = (e) => {
          e.preventDefault();
          if (target) write(target, r.text);
          menu.style.display = 'none';
        };
        menu.appendChild(b);
      }
      const foot = document.createElement('div');
      foot.style.cssText = 'padding:8px;color:#9ca3af;font-size:11px';
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
      if (menu.style.display !== 'none' && !menu.contains(e.target as Node) && e.target !== button) menu.style.display = 'none';
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') menu.style.display = 'none';
    });

    const scan = () => {
      if (!on || !kit || !kit.templates.length) return hide();
      const box = findBox();
      if (!box) return hide();
      if (!button.isConnected) document.body.append(button, menu);
      if (box !== target) menu.style.display = 'none';
      target = box;
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
      scan();
    };
    void load();
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (REPLY_KIT_KEY in changes || REPLIES_ON_KEY in changes)) void load();
    });
    // Vinted's app changes pages without reloading: look again after each change, and keep the button in place.
    // ERA's own button and menu never trigger another look.
    const mine = (n: Node) => button.contains(n) || menu.contains(n);
    new MutationObserver((records) => {
      if (on && kit && records.some((r) => !mine(r.target) && [...r.addedNodes, ...r.removedNodes].some((n) => !mine(n)))) schedule();
    }).observe(document.documentElement, { childList: true, subtree: true });
    addEventListener('scroll', place, true);
    addEventListener('resize', place);
  },
});
