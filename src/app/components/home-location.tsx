import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { repo } from '@/data/repo';
import { useI18n } from '@/i18n';
import { HOME_KEY, LEGACY_HOME_KEY, type Place, homeOf } from '@/intelligence/parcels';
import { Button, Field, Input } from '@/ui/components/primitives';
import { parseLatLng } from '@/utils/routeOptimizer';

/**
 * The seller's home, from settings.homeLocation (this device only); a home saved by an earlier version (homePlace) is
 * read too and moved over at the next save. undefined while reading, null when none is set.
 */
export function useHomeLocation(): Place | null | undefined {
  return useLiveQuery(async () => homeOf(await repo.getSetting(HOME_KEY, null)) ?? homeOf(await repo.getSetting(LEGACY_HOME_KEY, null)), []);
}

export async function saveHomeLocation(home: Place | null): Promise<void> {
  await repo.setSetting(HOME_KEY, home);
  await repo.setSetting(LEGACY_HOME_KEY, null);
}

/**
 * « Déplacer chez moi », one click: the town and its coordinates (copied from Google Maps), Entrée saves — or a click
 * on the map. Kept on this device only, used as the start and the end of the drop-off round.
 */
export function HomeLocationForm({ home, onDone }: { home: Place | null; onDone: () => void }) {
  const { t } = useI18n();
  const [city, setCity] = useState(home && home.label !== 'chez moi' ? home.label : '');
  const [coords, setCoords] = useState(home ? `${home.lat}, ${home.lng}` : '');
  const ll = parseLatLng(coords);
  const bad = coords.trim() !== '' && ll === null;
  return (
    <form
      className="home-form"
      data-testid="home-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ll) return;
        await saveHomeLocation({ ...ll, label: city.trim() || 'chez moi' });
        onDone();
      }}
    >
      <Field label={t('home.city')} htmlFor="home-city">
        <Input id="home-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder={t('home.cityPh')} autoFocus />
      </Field>
      <Field label={t('home.coords')} htmlFor="home-coords" error={bad ? t('drop.coordsBad') : null}>
        <Input id="home-coords" value={coords} onChange={(e) => setCoords(e.target.value)} placeholder={t('drop.coordsPh')} />
      </Field>
      <Button type="submit" variant="primary" icon="check" disabled={!ll}>
        {t('home.save')}
      </Button>
      <p className="t-small t-faint home-form__hint">{t('home.hint')}</p>
    </form>
  );
}
