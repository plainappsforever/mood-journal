import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { EntryEditor } from '@/components/entry-editor';
import { Screen, Label } from '@/components/ui';
import { getEntry, type Entry } from '@/db/entries';
import { useSQLiteContext } from '@/db/provider';
import { useT } from '@/hooks/use-t';

export default function EditEntry() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const t = useT();
  const [entry, setEntry] = useState<Entry | null | undefined>(undefined);
  useEffect(() => {
    getEntry(db, Number(id)).then(setEntry, () => setEntry(null));
  }, [db, id]);
  if (entry === undefined) return <Screen>{null}</Screen>;
  if (entry === null) return <Screen><Label>{t('error.notFound')}</Label></Screen>;
  return <EntryEditor entry={entry} moodId={null} date={null} />;
}
