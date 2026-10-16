import { useLocalSearchParams } from 'expo-router';

import { EntryEditor } from '@/components/entry-editor';
import { isValidDate } from '@/engine/dates';

// `/entry/new?mood=<mood id>&date=<YYYY-MM-DD>` — from a Home face (mood preselected) or a calendar day.
export default function NewEntry() {
  const { mood, date } = useLocalSearchParams<{ mood?: string; date?: string }>();
  const moodId = mood && Number.isInteger(Number(mood)) ? Number(mood) : null;
  return <EntryEditor entry={null} moodId={moodId} date={date && isValidDate(date) ? date : null} />;
}
