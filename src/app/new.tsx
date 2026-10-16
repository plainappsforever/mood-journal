import { Redirect, useLocalSearchParams, type Href } from 'expo-router';

import { useMoods } from '@/hooks/use-journal';

// Deep link `<scheme>://new?mood=<level 1–5>` (widgets, shortcuts): the editor with that level's first mood.
export default function NewFromLink() {
  const { mood } = useLocalSearchParams<{ mood?: string }>();
  const moods = useMoods();
  if (!moods) return null;
  const level = Number(mood);
  const picked = Number.isInteger(level) ? moods.firstOfLevel.get(level) : undefined;
  return <Redirect href={(picked ? `/entry/new?mood=${picked.id}` : '/entry/new') as Href} />;
}
