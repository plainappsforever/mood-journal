import { router, Stack, type Href } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/button';
import { Card, Chip, Field, Row, Screen, SectionTitle, Small, Wrap } from '@/components/ui';
import { addGroup, deleteGroup, moveGroup, renameGroup, setGroupArchived, type ActivityGroup } from '@/db/activities';
import { useSQLiteContext } from '@/db/provider';
import { useActivities } from '@/hooks/use-journal';
import { useT } from '@/hooks/use-t';
import { now } from '@/lib/clock';
import { showError } from '@/lib/errors';
import { write } from '@/lib/write';

export default function Activities() {
  const db = useSQLiteContext();
  const t = useT();
  const book = useActivities();
  const [groupName, setGroupName] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const act = (fn: () => Promise<unknown>, done?: () => void) => void write(fn).then(done, (e) => showError(t, e));
  const groupEditor = (g: ActivityGroup, count: number) => (
    <Card testID={`group-editor-${g.id}`}>
      <Field testID="group-rename" label={t('activities.groupName')} value={editing?.name ?? ''} onChangeText={(name) => setEditing({ id: g.id, name })} />
      <Button testID="group-rename-save" label={t('common.save')} disabled={!editing?.name.trim()} onPress={() => act(() => renameGroup(db, g.id, editing!.name), () => setEditing(null))} />
      <Wrap>
        <Chip testID="group-move-up" label={t('common.moveUp')} onPress={() => act(() => moveGroup(db, g.id, -1))} />
        <Chip testID="group-move-down" label={t('common.moveDown')} onPress={() => act(() => moveGroup(db, g.id, 1))} />
        <Chip testID="group-archive" label={g.archived ? t('common.unarchive') : t('common.archive')} onPress={() => act(() => setGroupArchived(db, g.id, !g.archived), () => setEditing(null))} />
        {count === 0 ? <Chip testID="group-delete" label={t('common.delete')} onPress={() => act(() => deleteGroup(db, g.id), () => setEditing(null))} /> : null}
      </Wrap>
      <Small>{count === 0 ? t('activities.groupEmpty') : t('activities.groupArchiveHint')}</Small>
      <Button testID="group-edit-cancel" variant="secondary" label={t('common.cancel')} onPress={() => setEditing(null)} />
    </Card>
  );
  return (
    <Screen testID="activities-screen">
      <Stack.Screen options={{ title: t('activities.title') }} />
      {(book?.groups ?? []).map((g) => (
        <View key={g.id}>
          <SectionTitle>{g.archived ? `${g.name} (${t('common.archived')})` : g.name}</SectionTitle>
          {editing?.id === g.id ? groupEditor(g, book!.all.filter((a) => a.groupId === g.id).length) : null}
          <Card>
            {book!.all
              .filter((a) => a.groupId === g.id)
              .map((a) => (
                <Row
                  key={a.id}
                  testID={`activity-row-${a.id}`}
                  label={`${a.emoji} ${a.name}`}
                  value={a.archived ? t('common.archived') : undefined}
                  onPress={() => router.push(`/activities/${a.id}` as Href)}
                />
              ))}
            <Wrap>
              <Chip testID={`activity-add-${g.id}`} label={`+ ${t('activities.add')}`} onPress={() => router.push(`/activities/new?group=${g.id}` as Href)} />
              <Chip testID={`group-edit-${g.id}`} label={t('activities.groupEdit')} onPress={() => setEditing({ id: g.id, name: g.name })} />
            </Wrap>
          </Card>
        </View>
      ))}
      {groupName === null ? (
        <Button testID="group-add" variant="secondary" label={t('activities.groupAdd')} onPress={() => setGroupName('')} />
      ) : (
        <Card>
          <Field testID="group-name" label={t('activities.groupName')} value={groupName} onChangeText={setGroupName} autoFocus />
          <Button
            testID="group-save"
            label={t('common.save')}
            disabled={!groupName.trim()}
            onPress={async () => {
              try {
                await write(() => addGroup(db, groupName, now()));
                setGroupName(null);
              } catch (e) {
                showError(t, e);
              }
            }}
          />
        </Card>
      )}
    </Screen>
  );
}
