import { useI18n } from '@/i18n';
import { Icon } from '@/ui/components/icons';
import { useEra } from '../state';

/**
 * The tabs of the two grouped sections. Kept apart from the screens so that opening one screen never loads another
 * one's code (each screen is its own lazily loaded file).
 */

export function StockTabs({ active }: { active: 'stock' | 'capital' | 'workshop' | 'quality' }) {
  const { t } = useI18n();
  const era = useEra();
  const n = era.workshop.toList.length;
  return (
    <nav className="subtabs" aria-label={t('stock.title')}>
      <a href="#/stock" aria-current={active === 'stock' ? 'page' : undefined}>
        <Icon name="stock" size={14} /> {t('stock.tabItems')}
      </a>
      <a href="#/workshop" aria-current={active === 'workshop' ? 'page' : undefined}>
        <Icon name="upload" size={14} /> {t('workshop.title')}
        {n > 0 && <span className="subtabs__n num">{n}</span>}
      </a>
      <a href="#/capital" aria-current={active === 'capital' ? 'page' : undefined}>
        <Icon name="capital" size={14} /> {t('capital.title')}
      </a>
      <a href="#/quality" aria-current={active === 'quality' ? 'page' : undefined}>
        <Icon name="target" size={14} /> {t('lq.tab')}
      </a>
    </nav>
  );
}

export function SalesTabs({ active }: { active: 'sales' | 'accounting' | 'parcels' }) {
  const { t } = useI18n();
  return (
    <nav className="subtabs" aria-label={t('sales.title')}>
      <a href="#/sales" aria-current={active === 'sales' ? 'page' : undefined}>
        {t('sales.title')}
      </a>
      <a href="#/parcels" aria-current={active === 'parcels' ? 'page' : undefined}>
        {t('parcelmap.title')}
      </a>
      <a href="#/accounting" aria-current={active === 'accounting' ? 'page' : undefined}>
        {t('accounting.title')}
      </a>
    </nav>
  );
}
