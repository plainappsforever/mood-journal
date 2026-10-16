// Daylio backup import (SPEC "Daylio import", D22, RESEARCH §3.2).
//
// DOCUMENTED (sources in RESEARCH §3.2): ZIP; member `backup.daylio` at the root = base64 text of UTF-8 JSON;
//   photos as `assets/<checksum>.<ext>`; JSON `version` 15; customMoods[] (id, custom_name, mood_group_id,
//   mood_group_order, icon_id, predefined_name_id 1 = rad … 5 = awful, state, createdAt); tags[] (id, name, icon,
//   order, state, id_tag_group); tag_groups[] (id, name, is_expanded, order); dayEntries[] (id, datetime ms UTC,
//   timeZoneOffset ms, year, month, day, hour, minute, mood = customMood id, note (may be HTML), note_title, tags[],
//   assets[]); assets[] (id, checksum, type; 1 = photo); goals[]; metadata.
// UNCONFIRMED (each marked below): mood_group_id 1…5 = best…worst (→ level pre-filled, user confirms); month 0- or
//   1-based (→ local date/time come from datetime + timeZoneOffset, split fields only cross-checked); encrypted
//   backups (→ detected from the ZIP flags, refused with a message); `state` ≠ 0 = archived; the photo member's
//   folder/extension (→ any member under assets/ whose file name without extension is the checksum).
import { unzipSync } from 'fflate';

import { formatTime, fromDayNumber } from './dates';
import {
  DAYLIO_PREDEFINED_NAMES,
  htmlToText,
  ImportError,
  MAX_IMPORT_BYTES,
  decodeEntities,
  type ImportSource,
  type ImportWarning,
  type SourceEntry,
} from './daylio-common';

export const TESTED_VERSION = 15;
const DAY_MS = 86_400_000;

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5) && (bytes[3] === 4 || bytes[3] === 6);
}

export type ZipMember = { name: string; flags: number; compressedSize: number; size: number; crc: number };

let CRC_TABLE: Uint32Array | null = null;

/** CRC-32 (IEEE, as in ZIP). fflate does not check it on unzip, so a changed byte in a stored member went unnoticed. */
export function crc32(bytes: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });
/** Strict UTF-8: a Latin-1 / Windows-1252 payload is refused instead of being read as mojibake. */
function utf8(bytes: Uint8Array, what: string): string {
  try {
    return UTF8.decode(bytes);
  } catch {
    throw new ImportError('damaged', `${what} is not UTF-8`);
  }
}

/** Central directory listing; throws 'zip64' / 'damaged'. Lets us refuse ZIP64 and encrypted members up front. */
export function listZip(bytes: Uint8Array): ZipMember[] {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ImportError('damaged', 'no end of central directory');
  const count = u16(bytes, eocd + 10);
  const size = u32(bytes, eocd + 12);
  const offset = u32(bytes, eocd + 16);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) throw new ImportError('zip64');
  if (eocd >= 20 && u32(bytes, eocd - 20) === 0x07064b50) throw new ImportError('zip64');
  const members: ZipMember[] = [];
  let p = offset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) throw new ImportError('damaged', 'central directory');
    const flags = u16(bytes, p + 8);
    const crc = u32(bytes, p + 16);
    const compressedSize = u32(bytes, p + 20);
    const uncompressed = u32(bytes, p + 24);
    const nameLength = u16(bytes, p + 28);
    const extraLength = u16(bytes, p + 30);
    const commentLength = u16(bytes, p + 32);
    if (compressedSize === 0xffffffff || uncompressed === 0xffffffff) throw new ImportError('zip64');
    const name = new TextDecoder('utf-8').decode(bytes.subarray(p + 46, p + 46 + nameLength));
    members.push({ name, flags, compressedSize, size: uncompressed, crc });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return members;
}

const base = (name: string) => name.slice(name.lastIndexOf('/') + 1);
const stem = (name: string) => {
  const b = base(name);
  const dot = b.lastIndexOf('.');
  return dot > 0 ? b.slice(0, dot) : b;
};

function decodeBase64(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 === 1) throw new ImportError('damaged', 'base64');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const out = new Uint8Array(Math.floor((clean.replace(/=+$/, '').length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let o = 0;
  for (const ch of clean) {
    if (ch === '=') break;
    buffer = (buffer << 6) | alphabet.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

type Json = Record<string, unknown>;
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Json[]) : []);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));

/** The parsed backup JSON (decoded from the ZIP member) — exposed for tests and the blind-set checker. */
export function readBackupJson(bytes: Uint8Array): { json: Json; warnings: ImportWarning[]; members: Map<string, Uint8Array> } {
  if (bytes.length > MAX_IMPORT_BYTES) throw new ImportError('tooLarge');
  if (!isZip(bytes)) throw new ImportError('notZip');
  const listing = listZip(bytes);
  if (listing.some((m) => (m.flags & 1) === 1)) throw new ImportError('encrypted'); // UNCONFIRMED whether Daylio ever does this
  const main = listing.find((m) => m.name === 'backup.daylio') ?? listing.find((m) => base(m.name) === 'backup.daylio');
  if (!main) throw new ImportError('notDaylio');
  let members: Record<string, Uint8Array>;
  try {
    members = unzipSync(bytes, { filter: (f) => f.name === main.name || /^(.*\/)?assets\//.test(f.name) });
  } catch (error) {
    throw new ImportError('damaged', String((error as Error).message ?? error));
  }
  // Every extracted member must match its CRC-32 from the central directory (blind set 1: backup-crc-mismatch).
  const crcOf = new Map(listing.map((m) => [m.name, m.crc]));
  for (const [name, data] of Object.entries(members)) {
    const expected = crcOf.get(name); // undefined only if fflate decoded a non-ASCII name differently: not checkable
    if (!name.endsWith('/') && expected !== undefined && crc32(data) !== expected) throw new ImportError('damaged', `CRC-32 of ${name}`);
  }
  const warnings: ImportWarning[] = [];
  const raw = utf8(members[main.name], 'backup member').trim();
  let text: string;
  if (raw.startsWith('{')) {
    warnings.push({ code: 'rawJson' });
    text = raw;
  } else {
    text = utf8(decodeBase64(raw), 'backup payload').replace(/^﻿/, '');
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ImportError('damaged', 'JSON');
  }
  if (!json || typeof json !== 'object' || Array.isArray(json) || !Array.isArray((json as Json).dayEntries)) throw new ImportError('notDaylio', 'no dayEntries');
  delete members[main.name];
  return { json: json as Json, warnings, members: new Map(Object.entries(members)) };
}

/** Local wall date/time of `utcMs + offsetMs` (no device zone). */
function wall(utcMs: number, offsetMs: number) {
  const local = utcMs + offsetMs;
  const t = new Date(local);
  return { date: fromDayNumber(Math.floor(local / DAY_MS)), time: formatTime(t.getUTCHours(), t.getUTCMinutes()), y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes() };
}

type Wall = { date: string; time: string; minute: number };

/**
 * Local date/time per entry (SPEC "Daylio import", review S6). Documented: local = datetime + timeZoneOffset (minute
 * truncated); the split fields year/month/day/hour/minute are what Daylio shows (UNCONFIRMED), month 0- or 1-based
 * (decided ONCE per file by majority of year+month votes). Rules:
 * - offset present: datetime + offset; a disagreeing split field is a per-entry `dateMismatch` warning — unless the
 *   file has ≥ MIN_SPLIT_EVIDENCE checkable entries and MORE than half of them disagree: then the file's datetime/offset
 *   pair is systematically wrong (e.g. a sign-flipped offset) and the split fields win for every entry that has them
 *   (`splitFieldsUsed`);
 * - offset missing: the split fields when valid, else UTC; `noOffset` warning either way (never silently UTC).
 * When the split fields win, `utc_ms` stays the real moment and the offset is derived (wall − utc, in minutes).
 */
const MIN_SPLIT_EVIDENCE = 5;

function planTiming(dayEntries: Json[]) {
  const offsetOf = (e: Json) => num(e.timeZoneOffset);
  let zeroVotes = 0;
  let oneVotes = 0;
  for (const e of dayEntries) {
    const utc = num(e.datetime);
    const [y, mo] = [num(e.year), num(e.month)];
    if (utc === null || y === null || mo === null) continue;
    const w = wall(utc, offsetOf(e) ?? 0);
    if (y !== w.y) continue;
    if (mo === w.m - 1) zeroVotes++;
    else if (mo === w.m) oneVotes++;
  }
  const monthBase = oneVotes > zeroVotes ? 1 : 0;
  const split = (e: Json): Wall | null => {
    const [y, mo, d, h, mi] = [num(e.year), num(e.month), num(e.day), num(e.hour), num(e.minute)];
    if (y === null || mo === null || d === null || h === null || mi === null) return null;
    if (![y, mo, d, h, mi].every(Number.isInteger) || h < 0 || h > 23 || mi < 0 || mi > 59) return null;
    const month = mo + 1 - monthBase;
    if (month < 1 || month > 12 || d < 1 || d > 31) return null;
    const ms = Date.UTC(y, month - 1, d, h, mi);
    const t = new Date(ms);
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== month - 1 || t.getUTCDate() !== d) return null;
    return { date: fromDayNumber(Math.floor(ms / DAY_MS)), time: formatTime(h, mi), minute: ms / 60_000 };
  };
  let checked = 0;
  let mismatching = 0;
  let noOffset = 0;
  for (const e of dayEntries) {
    const utc = num(e.datetime);
    if (utc === null) continue;
    const offset = offsetOf(e);
    if (offset === null) {
      noOffset++;
      continue;
    }
    const sw = split(e);
    if (!sw) continue;
    checked++;
    const w = wall(utc, offset);
    if (sw.date !== w.date || sw.time !== w.time) mismatching++;
  }
  const useSplit = checked >= MIN_SPLIT_EVIDENCE && mismatching * 2 > checked;
  const fromSplit = (sw: Wall, utcMs: number) => ({ date: sw.date, time: sw.time, offsetMin: sw.minute - Math.floor(utcMs / 60_000), mismatch: false });
  const localOf = (e: Json, utcMs: number) => {
    const offset = offsetOf(e);
    const sw = split(e);
    if (offset === null) {
      if (sw) return fromSplit(sw, utcMs);
      const w = wall(utcMs, 0);
      return { date: w.date, time: w.time, offsetMin: 0, mismatch: false };
    }
    if (useSplit && sw) return fromSplit(sw, utcMs);
    const w = wall(utcMs, offset);
    return { date: w.date, time: w.time, offsetMin: Math.round(offset / 60_000), mismatch: sw !== null && (sw.date !== w.date || sw.time !== w.time) };
  };
  return { checked, mismatching, noOffset, useSplit, localOf };
}

/** Reads a Daylio backup file into an ImportSource. Throws ImportError when the file cannot be read at all. */
export function readDaylioBackup(bytes: Uint8Array): ImportSource {
  const { json, warnings, members } = readBackupJson(bytes);
  const version = num(json.version);
  if (version !== TESTED_VERSION) warnings.push({ code: 'version', params: { version: version ?? '?' } });

  const moods = arr(json.customMoods).map((m) => {
    const id = str(m.id);
    const predefined = num(m.predefined_name_id);
    const group = num(m.mood_group_id);
    const custom = decodeEntities(str(m.custom_name)).trim();
    const name = custom || (predefined && predefined >= 1 && predefined <= 5 ? DAYLIO_PREDEFINED_NAMES[predefined - 1] : `mood ${id}`);
    // UNCONFIRMED: mood_group_id 1 … 5 = best … worst; fall back to the documented predefined_name_id.
    const levelFrom = (v: number | null) => (v && Number.isInteger(v) && v >= 1 && v <= 5 ? 6 - v : null);
    return { ref: id, name, proposedLevel: levelFrom(group) ?? levelFrom(predefined), archived: (num(m.state) ?? 0) !== 0 };
  });
  const moodRefs = new Set(moods.map((m) => m.ref));
  const groups = arr(json.tag_groups)
    .slice()
    .sort((a, b) => (num(a.order) ?? 0) - (num(b.order) ?? 0))
    .map((g) => ({ ref: str(g.id), name: decodeEntities(str(g.name)).trim() || `group ${str(g.id)}` }));
  const groupRefs = new Set(groups.map((g) => g.ref));
  const activities = arr(json.tags)
    .slice()
    .sort((a, b) => (num(a.order) ?? 0) - (num(b.order) ?? 0))
    .map((t) => {
      const g = str(t.id_tag_group);
      return { ref: str(t.id), name: decodeEntities(str(t.name)).trim() || `activity ${str(t.id)}`, groupRef: groupRefs.has(g) ? g : null, archived: (num(t.state) ?? 0) !== 0 };
    });
  const tagRefs = new Set(activities.map((a) => a.ref));
  const assets = new Map(arr(json.assets).map((a) => [str(a.id), { checksum: str(a.checksum), type: num(a.type) }]));
  const assetMembers = new Map<string, string>();
  for (const name of members.keys()) if (!name.endsWith('/')) assetMembers.set(stem(name), name);

  const skipped: ImportSource['skipped'] = [];
  const entries: SourceEntry[] = [];
  const dayEntries = arr(json.dayEntries);
  const timing = planTiming(dayEntries);
  if (timing.noOffset > 0) warnings.push({ code: 'noOffset', params: { n: timing.noOffset } });
  if (timing.useSplit) warnings.push({ code: 'splitFieldsUsed', params: { n: timing.mismatching, of: timing.checked } });
  for (const [index, e] of dayEntries.entries()) {
    const ref = str(e.id).trim();
    const where = ref || `#${index + 1}`;
    const utcMs = num(e.datetime);
    if (utcMs === null) {
      skipped.push({ where, reason: 'no time stamp' });
      warnings.push({ code: 'badRow', params: { row: where, reason: 'no time stamp' } });
      continue;
    }
    const moodRef = str(e.mood);
    if (!moodRefs.has(moodRef)) {
      skipped.push({ where, reason: 'unknown mood' });
      warnings.push({ code: 'unknownMood', params: { ref: where } });
      continue;
    }
    const local = timing.localOf(e, utcMs);
    if (local.mismatch) warnings.push({ code: 'dateMismatch', params: { ref: where } });
    const activityRefs: string[] = [];
    let unknownTag = false;
    for (const t of Array.isArray(e.tags) ? e.tags : []) {
      const tr = str(t);
      if (tagRefs.has(tr)) {
        if (!activityRefs.includes(tr)) activityRefs.push(tr);
      } else unknownTag = true;
    }
    if (unknownTag) warnings.push({ code: 'unknownTag', params: { ref: where } });
    const photos: SourceEntry['photos'] = [];
    for (const a of Array.isArray(e.assets) ? e.assets : []) {
      const asset = assets.get(str(a));
      if (!asset || asset.type !== 1) continue; // only photos (type 1) are imported
      const member = assetMembers.get(asset.checksum);
      if (!member) {
        warnings.push({ code: 'missingPhoto', params: { ref: where } });
        continue;
      }
      photos.push({ member, bytes: members.get(member)! });
    }
    entries.push({
      ref: ref || null,
      where,
      date: local.date,
      time: local.time,
      utcMs,
      tzOffsetMin: local.offsetMin,
      moodRef,
      activityRefs,
      // Titles are plain text: entities decoded, nothing else touched (review M1).
      noteTitle: decodeEntities(str(e.note_title)).trim(),
      note: htmlToText(str(e.note)),
      photos,
    });
  }
  if (entries.length === 0 && skipped.length === 0 && arr(json.dayEntries).length === 0) throw new ImportError('noEntries');
  return { kind: 'daylio_backup', version: version ?? undefined, moods, groups, activities, entries, warnings, skipped, goals: arr(json.goals).length };
}
