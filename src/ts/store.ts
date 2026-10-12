import {
  addDoc, arrayRemove, arrayUnion, collection, deleteDoc, doc, getDoc, increment, onSnapshot, updateDoc, writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { Category, Neta, NetaData, Person, PersonData, Relation, TalkLog } from './types';

export const MAX_TITLE = 60;
export const MAX_BODY = 1000;
export const MAX_NAME = 40;
export const MAX_PERSON_TEXT = 1000;
export const MAX_LOG_TEXT = 300;
export const MAX_LOGS = 100;
export const MAX_CATEGORY_NAME = 20;
export const MAX_CATEGORIES = 30;
export const MAX_NETA_PERSONS = 30;

const DEFAULT_CATEGORIES = ['雑談', '鉄板ネタ', '質問ネタ', 'ニュース', '趣味', '季節の話題'];

export const RELATIONS: Relation[] = ['work', 'friend', 'family', 'neighbor', 'other'];

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const msOrNull = (v: unknown): number | null => (typeof v === 'number' && v > 0 ? v : null);
const safeRelation = (v: unknown): Relation => (RELATIONS.includes(v as Relation) ? (v as Relation) : 'other');
const safeId = (v: unknown): string => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : '');

export function safeDate(v: unknown): string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function normIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  v.forEach((x) => {
    const id = safeId(x);
    if (id && !out.includes(id) && out.length < MAX_NETA_PERSONS) out.push(id);
  });
  return out;
}

function normLogs(v: unknown): TalkLog[] {
  if (!Array.isArray(v)) return [];
  const out: TalkLog[] = [];
  v.forEach((m) => {
    if (!m || typeof m !== 'object') return;
    const o = m as Record<string, unknown>;
    const id = safeId(o.id);
    const date = safeDate(o.date);
    const text = str(o.text, MAX_LOG_TEXT).trim();
    if (id && date && text) out.push({ id, date, text });
  });
  // 新しい日付が上。同じ日なら後から足したものが上
  return out
    .map((l, i) => ({ l, i }))
    .sort((a, b) => b.l.date.localeCompare(a.l.date) || b.i - a.i)
    .map(({ l }) => l)
    .slice(0, MAX_LOGS);
}

function sanitizeNeta(data: NetaData): NetaData {
  return {
    title: data.title.trim().slice(0, MAX_TITLE),
    body: data.body.slice(0, MAX_BODY),
    categoryId: data.categoryId.slice(0, 40),
    personIds: normIds(data.personIds),
  };
}

function sanitizePerson(data: PersonData): PersonData {
  return {
    name: data.name.trim().slice(0, MAX_NAME),
    relation: safeRelation(data.relation),
    cautions: data.cautions.slice(0, MAX_PERSON_TEXT),
    likes: data.likes.slice(0, MAX_PERSON_TEXT),
    memo: data.memo.slice(0, MAX_PERSON_TEXT),
  };
}

// ============================================================
// ネタ
// ============================================================
const netasCol = (uid: string) => collection(db, 'users', uid, 'netas');
const netaDoc = (uid: string, id: string) => doc(db, 'users', uid, 'netas', id);

export function subscribeNetas(
  uid: string,
  onData: (list: Neta[]) => void,
  onError: (err: Error) => void,
): () => void {
  return onSnapshot(netasCol(uid), (snap) => {
    const list: Neta[] = [];
    snap.forEach((d) => {
      const data = d.data();
      const createdAt = msOrNull(data.createdAt);
      const title = str(data.title, MAX_TITLE).trim();
      if (!createdAt || !title) return;
      list.push({
        id: d.id,
        title,
        body: str(data.body, MAX_BODY),
        categoryId: str(data.categoryId, 40),
        personIds: normIds(data.personIds),
        useCount: typeof data.useCount === 'number' && data.useCount > 0 ? Math.floor(data.useCount) : 0,
        lastUsedAt: safeDate(data.lastUsedAt),
        createdAt,
        updatedAt: msOrNull(data.updatedAt) ?? createdAt,
      });
    });
    onData(list);
  }, onError);
}

export async function createNeta(uid: string, data: NetaData): Promise<string> {
  const now = Date.now();
  const ref = await addDoc(netasCol(uid), {
    ...sanitizeNeta(data), useCount: 0, lastUsedAt: '', createdAt: now, updatedAt: now,
  });
  return ref.id;
}

export function updateNeta(uid: string, id: string, data: NetaData): Promise<void> {
  return updateDoc(netaDoc(uid, id), { ...sanitizeNeta(data), updatedAt: Date.now() });
}

export function deleteNeta(uid: string, id: string): Promise<void> {
  return deleteDoc(netaDoc(uid, id));
}

/**
 * ネタを「使った」にする。相手を指定したときは、その人の「話したいネタ」から外し、
 * 「前回話したこと」に記録を残す。
 */
export async function markNetaUsed(uid: string, neta: Neta, date: string, person?: Person): Promise<void> {
  const batch = writeBatch(db);
  const patch: Record<string, unknown> = { useCount: increment(1), lastUsedAt: safeDate(date) };
  if (person) {
    patch.personIds = arrayRemove(person.id);
    const log: TalkLog = { id: newId(), date: safeDate(date), text: `「${neta.title}」の話をした`.slice(0, MAX_LOG_TEXT) };
    batch.update(personDoc(uid, person.id), { logs: arrayUnion(log), updatedAt: Date.now() });
  }
  batch.update(netaDoc(uid, neta.id), patch);
  await batch.commit();
}

/** 使った回数を1つ戻す（押し間違いの取り消し用） */
export function undoNetaUsed(uid: string, id: string): Promise<void> {
  return updateDoc(netaDoc(uid, id), { useCount: increment(-1) });
}

// ============================================================
// ひと
// ============================================================
const personsCol = (uid: string) => collection(db, 'users', uid, 'persons');
const personDoc = (uid: string, id: string) => doc(db, 'users', uid, 'persons', id);

export function subscribePersons(
  uid: string,
  onData: (list: Person[]) => void,
  onError: (err: Error) => void,
): () => void {
  return onSnapshot(personsCol(uid), (snap) => {
    const list: Person[] = [];
    snap.forEach((d) => {
      const data = d.data();
      const createdAt = msOrNull(data.createdAt);
      const name = str(data.name, MAX_NAME).trim();
      if (!createdAt || !name) return;
      list.push({
        id: d.id,
        name,
        relation: safeRelation(data.relation),
        cautions: str(data.cautions, MAX_PERSON_TEXT),
        likes: str(data.likes, MAX_PERSON_TEXT),
        memo: str(data.memo, MAX_PERSON_TEXT),
        logs: normLogs(data.logs),
        createdAt,
        updatedAt: msOrNull(data.updatedAt) ?? createdAt,
      });
    });
    onData(list);
  }, onError);
}

export async function createPerson(uid: string, data: PersonData, logs: TalkLog[] = []): Promise<string> {
  const now = Date.now();
  const ref = await addDoc(personsCol(uid), {
    ...sanitizePerson(data), logs: normLogs(logs), createdAt: now, updatedAt: now,
  });
  return ref.id;
}

export function updatePerson(uid: string, id: string, data: PersonData): Promise<void> {
  return updateDoc(personDoc(uid, id), { ...sanitizePerson(data), updatedAt: Date.now() });
}

/** 人を削除し、ネタに付いていた「この人に話したい」の紐づけも外す（ネタ自体は消さない） */
export async function deletePerson(uid: string, id: string, netaIds: string[]): Promise<void> {
  for (let i = 0; i < netaIds.length; i += 400) {
    const batch = writeBatch(db);
    netaIds.slice(i, i + 400).forEach((nid) => batch.update(netaDoc(uid, nid), { personIds: arrayRemove(id) }));
    await batch.commit();
  }
  await deleteDoc(personDoc(uid, id));
}

export function addTalkLog(uid: string, personId: string, date: string, text: string): Promise<void> {
  const log: TalkLog = { id: newId(), date: safeDate(date), text: text.trim().slice(0, MAX_LOG_TEXT) };
  return updateDoc(personDoc(uid, personId), { logs: arrayUnion(log), updatedAt: Date.now() });
}

export function deleteTalkLog(uid: string, personId: string, log: TalkLog): Promise<void> {
  return updateDoc(personDoc(uid, personId), { logs: arrayRemove(log) });
}

// ============================================================
// カテゴリ（ネタ用）
// ============================================================
const categoriesCol = (uid: string) => collection(db, 'users', uid, 'categories');
const metaDoc = (uid: string) => doc(db, 'users', uid, 'meta', 'profile');

export function subscribeCategories(
  uid: string,
  onData: (list: Category[]) => void,
  onError: (err: Error) => void,
): () => void {
  return onSnapshot(categoriesCol(uid), (snap) => {
    const list: Category[] = [];
    snap.forEach((d) => {
      const data = d.data();
      const createdAt = msOrNull(data.createdAt);
      const name = str(data.name, MAX_CATEGORY_NAME).trim();
      if (!createdAt || !name) return;
      list.push({ id: d.id, name, createdAt });
    });
    list.sort((a, b) => a.createdAt - b.createdAt);
    onData(list);
  }, onError);
}

/** 初回ログイン時だけ、よく使うカテゴリを用意しておく（全部消した後に復活させないようフラグで管理） */
export async function ensureDefaultCategories(uid: string): Promise<void> {
  const meta = await getDoc(metaDoc(uid));
  if (meta.exists() && meta.data().categoriesSeeded === true) return;
  const batch = writeBatch(db);
  const now = Date.now();
  DEFAULT_CATEGORIES.forEach((name, i) => {
    batch.set(doc(categoriesCol(uid)), { name, createdAt: now + i });
  });
  batch.set(metaDoc(uid), { categoriesSeeded: true }, { merge: true });
  await batch.commit();
}

export async function createCategory(uid: string, name: string): Promise<string> {
  const ref = await addDoc(categoriesCol(uid), { name: name.trim().slice(0, MAX_CATEGORY_NAME), createdAt: Date.now() });
  return ref.id;
}

export function renameCategory(uid: string, id: string, name: string): Promise<void> {
  return updateDoc(doc(db, 'users', uid, 'categories', id), { name: name.trim().slice(0, MAX_CATEGORY_NAME) });
}

/** カテゴリを削除し、中のネタは未分類に戻す（ネタ自体は消さない） */
export async function deleteCategory(uid: string, id: string, netaIds: string[]): Promise<void> {
  for (let i = 0; i < netaIds.length; i += 400) {
    const batch = writeBatch(db);
    netaIds.slice(i, i + 400).forEach((nid) => batch.update(netaDoc(uid, nid), { categoryId: '' }));
    await batch.commit();
  }
  await deleteDoc(doc(db, 'users', uid, 'categories', id));
}
