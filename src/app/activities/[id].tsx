import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { EmojiPicker } from '@/components/emoji-picker';
import { Chip, Field, Label, Screen, SectionTitle, Wrap } from '@/components/ui';
import { activityUsage, addActivity, deleteActivity, moveActivity, setActivityArchived, updateActivity, type Activity } from '@/db/activities';
import { useSQLiteContext } from '@/db/provider';
import { useActivities, type ActivityBook } from '@/hooks/use-journal';
import { now } from '@/lib/clock';
import { showError } from '@/lib/errors';
import { translatePlural } from '@/lib/i18n';
import { useLanguage, useT } from '@/hooks/use-t';
import { write } from '@/lib/write';

export default function ActivityEditorRoute() {
  const { id, group } = useLocalSearchParams<{ id: string; group?: string }>();
  const book = useActivities();
  const isNew = id === 'new';
  const activity = isNew ? null : (book?.byId.get(Number(id)) ?? null);
  if (!book || (!isNew && !activity)) return <Screen>{null}</Screen>;
  return <ActivityEditor key={activity?.id ?? 'new'} activity={activity} book={book} defaultGroup={group ? Number(group) : null} />;
}

function ActivityEditor({ activity, book, defaultGroup }: { activity: Activity | null; book: ActivityBook; defaultGroup: number | null }) {
  const isNew = activity === null;
  const db = useSQLiteContext();
  const t = useT();
  const language = useLanguage();
  const [name, setName] = useState(activity?.name ?? '');
  const [emoji, setEmoji] = useState(activity?.emoji ?? '⭐');
  const [groupId, setGroupId] = useState<number | null>(activity?.groupId ?? defaultGroup);

  const groups = book.groups.filter((g) => !g.archived || g.id === groupId);
  const gid = groupId ?? groups[0]?.id ?? null;

  const save = async () => {
    if (gid === null) return;
    try {
      if (activity) await write(() => updateActivity(db, activity.id, { groupId: gid, name, emoji }));
      else await write(() => addActivity(db, { groupId: gid, name, emoji }, now()));
      router.back();
    } catch (e) {
      showError(t, e);
    }
  };

  return (
    <Screen testID="activity-editor">
      <Stack.Screen options={{ title: isNew ? t('activities.add') : t('activities.edit') }} />
      <Label>{emoji}</Label>
      <Field testID="activity-name" label={t('activities.name')} value={name} onChangeText={setName} maxLength={40} />
      <EmojiPicker value={emoji} onChange={setEmoji} />
      <SectionTitle>{t('activities.group')}</SectionTitle>
      <Wrap>
        {groups.map((g) => (
          <Chip key={g.id} testID={`activity-group-${g.id}`} label={g.name} selected={g.id === gid} onPress={() => setGroupId(g.id)} />
        ))}
      </Wrap>
      <Button testID="activity-save" label={t('common.save')} disabled={!name.trim()} onPress={() => void save()} />
      {activity ? (
        <>
          <View style={styles.row}>
            <Button testID="move-up" variant="secondary" style={styles.flex} label={t('common.moveUp')} onPress={() => void write(() => moveActivity(db, activity.id, -1)).catch((e) => showError(t, e))} />
            <Button testID="move-down" variant="secondary" style={styles.flex} label={t('common.moveDown')} onPress={() => void write(() => moveActivity(db, activity.id, 1)).catch((e) => showError(t, e))} />
          </View>
          <Button
            testID="activity-archive"
            variant="secondary"
            label={activity.archived ? t('common.unarchive') : t('common.archive')}
            onPress={async () => {
              try {
                await write(() => setActivityArchived(db, activity.id, !activity.archived));
                router.back();
              } catch (e) {
                showError(t, e);
              }
            }}
          />
          <Button
            testID="activity-delete"
            variant="secondary"
            label={t('activities.delete')}
            onPress={async () => {
              const use = await activityUsage(db, activity.id);
              const text =
                use.entries === 0 && use.goals === 0
                  ? t('activities.deleteUnused', { name: activity.name })
                  : t('activities.deleteUsed', {
                      entries: translatePlural(language, 'count.entries', use.entries),
                      goals: translatePlural(language, 'count.goals', use.goals),
                    });
              Alert.alert(t('activities.deleteTitle'), text, [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('common.delete'),
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await write(() => deleteActivity(db, activity.id));
                      router.back();
                    } catch (e) {
                      showError(t, e);
                    }
                  },
                },
              ]);
            }}
          />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
});
