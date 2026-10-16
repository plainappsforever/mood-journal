import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Image } from 'expo-image';
import { router, useNavigation } from 'expo-router';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { MoodFace } from '@/components/mood-face';
import { Button } from '@/components/button';
import { Chip, Field, Screen, SectionTitle, Small, Wrap } from '@/components/ui';
import { addActivity } from '@/db/activities';
import { addEntry, addPhoto, deleteEntry, MAX_PHOTOS_PER_ENTRY, removePhoto, updateEntry, type Entry, type Photo, type PhotoInput } from '@/db/entries';
import { useSQLiteContext } from '@/db/provider';
import { dayNumber, fromDayNumber, parseTime, formatTime, utcForJournalTime, type DateStr } from '@/engine/dates';
import type { JournalSettings } from '@/db/settings';
import { useActivities, useFormatter, useLoadedSettings, useMoods, type ActivityBook, type MoodBook } from '@/hooks/use-journal';
import { useTheme } from '@/hooks/use-theme';
import { calendarToday, newEntryMoment, now, offsetAt } from '@/lib/clock';
import { showError } from '@/lib/errors';
import { formatClock, formatDayRelative } from '@/lib/locale';
import { photoExists, photoUri, pickPhoto, removePhotoFiles } from '@/lib/photos';
import { write } from '@/lib/write';
import { Spacing } from '@/constants/theme';

type Draft = { moodId: number | null; date: DateStr; time: string; utcMs: number | null; activityIds: number[]; noteTitle: string; note: string };

function initialDraft(entry: Entry | null, moodId: number | null, date: DateStr | null, dayEndHour: number): Draft {
  if (entry) {
    return { moodId: entry.moodId, date: entry.localDate, time: entry.localTime, utcMs: entry.utcMs, activityIds: entry.activityIds, noteTitle: entry.noteTitle, note: entry.note };
  }
  const moment = newEntryMoment(dayEndHour);
  // From a calendar day: that day at the current wall time (moment recomputed on save). From Home: now (Formula 14).
  if (date) return { moodId, date, time: moment.localTime, utcMs: null, activityIds: [], noteTitle: '', note: '' };
  return { moodId, date: moment.localDate, time: moment.localTime, utcMs: moment.utcMs, activityIds: [], noteTitle: '', note: '' };
}

type Props = { entry: Entry | null; moodId: number | null; date: DateStr | null };

/** Entry editor (SPEC Screens): moods by level, date/time, activities by group, title, note, ≤ 3 photos. */
export function EntryEditor(props: Props) {
  const settings = useLoadedSettings();
  const moods = useMoods();
  const activities = useActivities();
  // The draft's journal day needs the real day-end hour (Formula 14), so nothing renders before the settings are read.
  if (!settings || !moods || !activities) return <Screen testID="entry-loading">{null}</Screen>;
  return <Editor {...props} settings={settings} moods={moods} activities={activities} />;
}

function Editor({ entry, moodId, date, settings, moods, activities }: Props & { settings: JournalSettings; moods: MoodBook; activities: ActivityBook }) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const f = useFormatter();
  const { t, locale } = f;
  const navigation = useNavigation();
  const [draft, setDraft] = useState<Draft>(() => initialDraft(entry, moodId, date, settings.dayEndHour));
  const [photos, setPhotos] = useState<Photo[]>(entry?.photos ?? []);
  const [pending, setPending] = useState<PhotoInput[]>([]);
  const [removed, setRemoved] = useState<Photo[]>([]);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  const [adding, setAdding] = useState<{ name: string; groupId: number | null } | null>(null);
  const [saving, setSaving] = useState(false);
  // review S7: photos picked here are stored at once; if the editor closes without saving, those files are removed again.
  const unsaved = useRef<PhotoInput[]>([]);
  useEffect(() => {
    unsaved.current = pending;
  }, [pending]);
  const saved = useRef(false);
  useEffect(
    () => () => {
      if (!saved.current) removePhotoFiles(unsaved.current.map((p) => p.file));
    },
    []
  );
  // "Yesterday, 01:30": relative words compare with the calendar date (the journal day is already yesterday).
  const calendarDay = calendarToday();

  const save = async () => {
    if (saving || draft.moodId === null) return;
    setSaving(true);
    try {
      const off = offsetAt();
      const utcMs = draft.utcMs ?? utcForJournalTime(draft.date, draft.time, settings.dayEndHour, off);
      const input = {
        moodId: draft.moodId,
        localDate: draft.date,
        localTime: draft.time,
        utcMs,
        tzOffsetMin: off(utcMs),
        noteTitle: draft.noteTitle,
        note: draft.note,
        activityIds: draft.activityIds,
      };
      const opts = { now: now(), today: calendarToday() };
      await write(async () => {
        const id = entry ? (await updateEntry(db, entry.id, input, opts), entry.id) : await addEntry(db, input, opts);
        for (const p of removed) await removePhoto(db, p.id);
        for (const p of pending) await addPhoto(db, id, p);
      });
      saved.current = true;
      removePhotoFiles(removed.map((p) => p.file));
      router.back();
    } catch (e) {
      showError(t, e);
      setSaving(false);
    }
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      title: entry ? t('entry.editTitle') : t('entry.newTitle'),
      headerRight: () => (
        <Pressable testID="entry-save" accessibilityRole="button" onPress={() => void save()} hitSlop={12} style={styles.headerBtn} disabled={draft.moodId === null}>
          <Text style={[styles.headerText, { color: draft.moodId === null ? theme.textSecondary : theme.tint }]}>{t('common.save')}</Text>
        </Pressable>
      ),
    });
  });

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const toggleActivity = (id: number) =>
    set({ activityIds: draft.activityIds.includes(id) ? draft.activityIds.filter((a) => a !== id) : [...draft.activityIds, id] });
  const setDate = (d: DateStr) => set({ date: d, utcMs: null });
  const setTime = (time: string) => set({ time, utcMs: null });
  const dateObj = new Date(dayNumber(draft.date) * 86_400_000 + 12 * 3_600_000);
  const { hour, minute } = parseTime(draft.time);
  const timeObj = new Date(Date.UTC(2026, 0, 1, hour, minute));

  const openPicker = (mode: 'date' | 'time') => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: mode === 'date' ? dateObj : timeObj,
        mode,
        timeZoneName: 'UTC',
        is24Hour: true,
        onChange: (e, d) => {
          if (e.type !== 'set' || !d) return;
          if (mode === 'date') setDate(fromDayNumber(Math.floor(d.getTime() / 86_400_000)));
          else setTime(formatTime(d.getUTCHours(), d.getUTCMinutes()));
        },
      });
    } else {
      setPicker(picker === mode ? null : mode);
    }
  };

  const allPhotos = [...photos.map((p) => ({ key: `s${p.id}`, uri: photoUri(p.file), ok: photoExists(p.file), stored: p })), ...pending.map((p, i) => ({ key: `p${i}`, uri: photoUri(p.file), ok: true, stored: null as Photo | null, pendingIndex: i }))];

  const addPhotoFrom = async (source: 'library' | 'camera') => {
    try {
      const r = await pickPhoto(source);
      if ('photo' in r) setPending((p) => [...p, r.photo]);
      else if ('denied' in r) Alert.alert(t('photo.cameraDeniedTitle'), t('photo.cameraDenied'));
    } catch (e) {
      showError(t, e);
    }
  };

  // Archived groups stay hidden unless this entry uses one of their activities (its history stays visible).
  const groups = activities.groups.filter((g) => !g.archived || activities.all.some((a) => a.groupId === g.id && draft.activityIds.includes(a.id)));

  return (
    <Screen testID="entry-editor">
      <View style={styles.moods}>
        {[5, 4, 3, 2, 1].map((level) => (
          <View key={level} style={styles.levelCol}>
            {moods.all
              .filter((m) => m.level === level && (!m.archived || m.id === draft.moodId))
              .map((m) => (
                <MoodFace key={m.id} mood={m} size={44} label selected={m.id === draft.moodId} testID={`mood-${m.id}`} onPress={() => set({ moodId: m.id })} />
              ))}
          </View>
        ))}
      </View>
      {draft.moodId === null ? <Small>{t('entry.pickMood')}</Small> : null}

      <View style={styles.when}>
        <Chip testID="entry-date" label={formatDayRelative(t, locale, draft.date, calendarDay)} onPress={() => openPicker('date')} />
        <Chip testID="entry-time" label={formatClock(locale, draft.time)} onPress={() => openPicker('time')} />
      </View>
      <Text testID="entry-when" style={{ color: theme.textSecondary }}>
        {`${formatDayRelative(t, locale, draft.date, calendarDay)}, ${draft.time}`}
      </Text>
      {picker === 'date' && Platform.OS === 'ios' ? (
        <DateTimePicker testID="entry-date-picker" value={dateObj} mode="date" display="inline" timeZoneName="UTC" maximumDate={new Date((dayNumber(calendarToday()) + 1) * 86_400_000)} onChange={(_e, d) => d && setDate(fromDayNumber(Math.floor(d.getTime() / 86_400_000)))} />
      ) : null}
      {picker === 'time' && Platform.OS === 'ios' ? (
        <DateTimePicker testID="entry-time-picker" value={timeObj} mode="time" display="spinner" timeZoneName="UTC" onChange={(_e, d) => d && setTime(formatTime(d.getUTCHours(), d.getUTCMinutes()))} />
      ) : null}

      {groups.map((g) => {
        const list = activities.all.filter((a) => a.groupId === g.id && (!a.archived || draft.activityIds.includes(a.id)));
        const isCollapsed = collapsed.has(g.id);
        return (
          <View key={g.id} style={styles.group}>
            <Pressable
              testID={`group-${g.id}`}
              accessibilityRole="button"
              accessibilityState={{ expanded: !isCollapsed }}
              onPress={() => {
                const next = new Set(collapsed);
                if (isCollapsed) next.delete(g.id);
                else next.add(g.id);
                setCollapsed(next);
              }}>
              <SectionTitle>{`${isCollapsed ? '▸' : '▾'} ${g.name}`}</SectionTitle>
            </Pressable>
            {isCollapsed ? null : (
              <Wrap>
                {list.map((a) => (
                  <Chip key={a.id} testID={`activity-${a.id}`} label={`${a.emoji} ${a.name}${a.archived ? ` (${t('common.archived')})` : ''}`} selected={draft.activityIds.includes(a.id)} onPress={() => toggleActivity(a.id)} />
                ))}
              </Wrap>
            )}
          </View>
        );
      })}
      {adding ? (
        <View style={styles.group}>
          <Field testID="activity-add-name" label={t('activities.name')} value={adding.name} autoFocus onChangeText={(name) => setAdding({ ...adding, name })} />
          <Wrap>
            {groups.map((g) => (
              <Chip key={g.id} testID={`activity-add-group-${g.id}`} label={g.name} selected={(adding.groupId ?? groups[0]?.id) === g.id} onPress={() => setAdding({ ...adding, groupId: g.id })} />
            ))}
          </Wrap>
          <Button
            testID="activity-add-save"
            label={t('activities.add')}
            disabled={!adding.name.trim()}
            onPress={async () => {
              const groupId = adding.groupId ?? groups[0]?.id;
              if (groupId === undefined) return;
              try {
                const id = await write(() => addActivity(db, { groupId, name: adding.name, emoji: '•' }, now()));
                set({ activityIds: [...draft.activityIds, id] });
                setAdding(null);
              } catch (e) {
                showError(t, e);
              }
            }}
          />
        </View>
      ) : (
        <Chip testID="activity-add-inline" label={`+ ${t('activities.add')}`} onPress={() => setAdding({ name: '', groupId: null })} />
      )}

      <Field testID="note-title" label={t('entry.noteTitle')} value={draft.noteTitle} onChangeText={(noteTitle) => set({ noteTitle })} maxLength={200} />
      <Field testID="note-input" label={t('entry.note')} value={draft.note} onChangeText={(note) => set({ note })} multiline />

      <SectionTitle>{t('entry.photos')}</SectionTitle>
      <View style={styles.photos}>
        {allPhotos.map((p, n) => (
          <View key={p.key} testID={`photo-${n}`} style={styles.photoBox}>
            {p.ok ? <Image source={{ uri: p.uri }} style={styles.photo} contentFit="cover" /> : <View style={[styles.photo, { backgroundColor: theme.empty }]}><Small>{t('photo.missing')}</Small></View>}
            <Pressable
              testID={`photo-${n}-remove`}
              accessibilityRole="button"
              accessibilityLabel={t('photo.remove')}
              style={[styles.remove, { backgroundColor: theme.background }]}
              onPress={() => {
                if (p.stored) {
                  const stored = p.stored;
                  setPhotos((list) => list.filter((x) => x.id !== stored.id));
                  setRemoved((list) => [...list, stored]);
                } else if ('pendingIndex' in p) {
                  const file = pending[p.pendingIndex as number]?.file;
                  setPending((list) => list.filter((_x, i) => i !== p.pendingIndex));
                  if (file) removePhotoFiles([file]);
                }
              }}>
              <Text style={{ color: theme.text }}>✕</Text>
            </Pressable>
          </View>
        ))}
        {allPhotos.length < MAX_PHOTOS_PER_ENTRY ? (
          <Chip
            testID="photo-add"
            label={`+ ${t('entry.addPhoto')}`}
            onPress={() =>
              Alert.alert(t('entry.addPhoto'), undefined, [
                { text: t('photo.choose'), onPress: () => void addPhotoFrom('library') },
                { text: t('photo.take'), onPress: () => void addPhotoFrom('camera') },
                { text: t('common.cancel'), style: 'cancel' },
              ])
            }
          />
        ) : null}
      </View>

      <Button testID="entry-save-bottom" label={t('common.save')} disabled={draft.moodId === null || saving} onPress={() => void save()} />
      {entry ? (
        <Button
          testID="entry-delete"
          variant="secondary"
          label={t('entry.delete')}
          onPress={() =>
            Alert.alert(t('entry.deleteTitle'), t('entry.deleteText'), [
              { text: t('common.cancel'), style: 'cancel' },
              {
                text: t('common.delete'),
                style: 'destructive',
                onPress: async () => {
                  try {
                    const files = await write(() => deleteEntry(db, entry.id));
                    removePhotoFiles(files);
                    router.back();
                  } catch (e) {
                    showError(t, e);
                  }
                },
              },
            ])
          }
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  moods: { flexDirection: 'row', justifyContent: 'space-between' },
  levelCol: { alignItems: 'center', gap: Spacing.two },
  when: { flexDirection: 'row', gap: Spacing.two },
  group: { gap: Spacing.two },
  photos: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap', alignItems: 'center' },
  photoBox: { width: 88, height: 88 },
  photo: { width: 88, height: 88, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  remove: { position: 'absolute', top: 4, right: 4, borderRadius: 12, width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  headerBtn: { paddingHorizontal: 12 },
  headerText: { fontSize: 17, fontWeight: '600' },
});
