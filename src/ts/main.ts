import { User } from 'firebase/auth';
import { loginWithGoogle, logout, onAuthChange } from './auth';
import { submitFeedback } from './feedback';
import { SAMPLE_NETAS, SAMPLE_PERSON } from './samples';
import {
  addTalkLog, createCategory, createNeta, createPerson, deleteCategory, deleteNeta, deletePerson, deleteTalkLog,
  ensureDefaultCategories, markNetaUsed, MAX_CATEGORIES, MAX_LOGS, newId, RELATIONS, renameCategory,
  subscribeCategories, subscribeNetas, subscribePersons, undoNetaUsed, updateNeta, updatePerson,
} from './store';
import { Category, Neta, NetaData, Person, PersonData, Relation } from './types';
import { closeOverlay, iconEl, openOverlay, showToast, textEl } from './ui';

// ============================================================
// 固定アイコン（開発者定義のSVGのみ。ユーザー入力は含めない）
// ============================================================
const svg = (inner: string, size = 18): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICON_EDIT = '<path d="M40 12 L52 24 L24 52 H12 V40 Z"/><path d="M34 18 L46 30"/>';
const ICON_TRASH = '<path d="M12 18 H52"/><path d="M26 18 V12 H38 V18"/><path d="M17 18 L20 54 H44 L47 18"/>';
const ICON_CAUTION = '<path d="M32 10 L56 52 H8 Z"/><path d="M32 26 V38"/><circle cx="32" cy="45" r="2" fill="currentColor" stroke="none"/>';
const ICON_CHECK = '<path d="M14 34 L26 46 L50 20"/>';

const RELATION_LABEL: Record<Relation, string> = {
  work: '仕事', friend: '友人', family: '家族', neighbor: 'ご近所', other: 'その他',
};

const TAB_KEY = 'zatsudan-pocket:tab';
const NETA_SORT_KEY = 'zatsudan-pocket:neta-sort';
const PERSON_SORT_KEY = 'zatsudan-pocket:person-sort';
const CATEGORY_KEY = 'zatsudan-pocket:category';
const RELATION_KEY = 'zatsudan-pocket:relation';
const UNCATEGORIZED = '__none__';
const ALL = '__all__';
const NETA_SORTS = ['new', 'fresh', 'few', 'many', 'title'];
const PERSON_SORTS = ['updated', 'talked', 'long', 'name'];

type Tab = 'neta' | 'person';

// ============================================================
// 状態
// ============================================================
let currentUser: User | null = null;
let netas: Neta[] = [];
let persons: Person[] = [];
let categories: Category[] = [];
let netasLoaded = false;
let personsLoaded = false;
let unsubs: (() => void)[] = [];

let tab: Tab = lsGet(TAB_KEY) === 'person' ? 'person' : 'neta';
let netaQuery = '';
let personQuery = '';
let selectedCategory = lsGet(CATEGORY_KEY) || ALL;
let selectedRelation = lsGet(RELATION_KEY) || ALL;
let netaSort = lsGet(NETA_SORT_KEY) || 'new';
let personSort = lsGet(PERSON_SORT_KEY) || 'updated';

let netaDetailId: string | null = null;
let personDetailId: string | null = null;

let editingNetaId: string | null = null;
let netaEditorPersons: string[] = [];
let editingPersonId: string | null = null;
let editorSnapshot = '';
let editorBusy = false;
let activeEditor: 'neta' | 'person' | null = null;

let omakaseId: string | null = null;
let confirmAction: (() => Promise<void>) | null = null;

// ============================================================
// 要素
// ============================================================
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} が見つかりません`);
  return el as T;
};

const loginScreen = $('login-screen');
const appEl = $('app');
const loadingEl = $('loading');

const netaPanel = $('panel-neta');
const personPanel = $('panel-person');
const tabNeta = $('tab-neta');
const tabPerson = $('tab-person');

const netaList = $<HTMLUListElement>('neta-list');
const personList = $<HTMLUListElement>('person-list');
const categoryBar = $('category-bar');
const relationBar = $('relation-bar');

const netaDetailOverlay = $('neta-detail-overlay');
const netaEditorOverlay = $('neta-editor-overlay');
const omakaseOverlay = $('omakase-overlay');
const personDetailOverlay = $('person-detail-overlay');
const personEditorOverlay = $('person-editor-overlay');
const categoryOverlay = $('category-overlay');
const discardOverlay = $('discard-dialog-overlay');
const confirmOverlay = $('confirm-dialog-overlay');
const feedbackOverlay = $('feedback-modal-overlay');

const netaTitleInput = $<HTMLInputElement>('input-neta-title');
const netaCategorySelect = $<HTMLSelectElement>('input-neta-category');
const netaBodyInput = $<HTMLTextAreaElement>('input-neta-body');
const netaPersonPicker = $('neta-person-picker');
const netaSaveBtn = $<HTMLButtonElement>('btn-neta-editor-save');

const personNameInput = $<HTMLInputElement>('input-person-name');
const personRelationSelect = $<HTMLSelectElement>('input-person-relation');
const personCautionsInput = $<HTMLTextAreaElement>('input-person-cautions');
const personLikesInput = $<HTMLTextAreaElement>('input-person-likes');
const personMemoInput = $<HTMLTextAreaElement>('input-person-memo');
const personSaveBtn = $<HTMLButtonElement>('btn-person-editor-save');

const logDateInput = $<HTMLInputElement>('input-log-date');
const logTextInput = $<HTMLInputElement>('input-log-text');

// ============================================================
// ユーティリティ
// ============================================================
function lsGet(key: string): string {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* プライベートモードなどでは保存しない */
  }
}

function todayStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDate(s: string): string {
  const [y, m, d] = s.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

/** 指定日からの経過日数（未来の日付や未入力は null） */
function daysSince(s: string): number | null {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  const then = new Date(y, m - 1, d).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diff = Math.round((today - then) / 86_400_000);
  return diff >= 0 ? diff : null;
}

function agoText(s: string): string {
  const days = daysSince(s);
  if (days === null) return '';
  if (days === 0) return '今日';
  if (days === 1) return '昨日';
  return `${days}日前`;
}

function categoryName(id: string): string {
  return categories.find((c) => c.id === id)?.name ?? '';
}

function personName(id: string): string {
  return persons.find((p) => p.id === id)?.name ?? '';
}

const findNeta = (id: string | null): Neta | undefined => (id ? netas.find((n) => n.id === id) : undefined);
const findPerson = (id: string | null): Person | undefined => (id ? persons.find((p) => p.id === id) : undefined);

/** その人に話したいネタ（存在する人だけを対象） */
const netasFor = (personId: string): Neta[] => netas.filter((n) => n.personIds.includes(personId));

const lastTalked = (p: Person): string => p.logs[0]?.date ?? '';

function chipButton(label: string, count: number, active: boolean, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'category-chip' + (active ? ' is-active' : '');
  b.setAttribute('aria-pressed', String(active));
  b.append(textEl('span', '', label), textEl('span', 'category-chip__count', String(count)));
  b.addEventListener('click', onClick);
  return b;
}

/** 二重送信を防ぎつつ、失敗時はトーストで知らせる */
const busyKeys = new Set<string>();
async function guarded(key: string, btn: HTMLButtonElement | null, fn: () => Promise<void>, failMsg = '保存に失敗しました。通信環境を確認してください'): Promise<void> {
  if (busyKeys.has(key)) return;
  busyKeys.add(key);
  if (btn) btn.disabled = true;
  try {
    await fn();
  } catch (err) {
    console.error(err);
    showToast(failMsg);
  } finally {
    busyKeys.delete(key);
    if (btn) btn.disabled = false;
  }
}

// ============================================================
// タブ
// ============================================================
function setTab(next: Tab): void {
  tab = next;
  lsSet(TAB_KEY, next);
  render();
}

function renderTabs(): void {
  const isNeta = tab === 'neta';
  tabNeta.classList.toggle('is-active', isNeta);
  tabPerson.classList.toggle('is-active', !isNeta);
  tabNeta.setAttribute('aria-selected', String(isNeta));
  tabPerson.setAttribute('aria-selected', String(!isNeta));
  $('tab-neta-count').textContent = netas.length ? String(netas.length) : '';
  $('tab-person-count').textContent = persons.length ? String(persons.length) : '';
  netaPanel.classList.toggle('hidden', !isNeta);
  personPanel.classList.toggle('hidden', isNeta);
}

// ============================================================
// ネタ一覧
// ============================================================
function filteredNetas(): Neta[] {
  const q = netaQuery.trim().toLowerCase();
  const list = netas.filter((n) => {
    if (selectedCategory === UNCATEGORIZED) {
      if (n.categoryId && categoryName(n.categoryId)) return false;
    } else if (selectedCategory !== ALL && n.categoryId !== selectedCategory) {
      return false;
    }
    if (!q) return true;
    const hay = [n.title, n.body, categoryName(n.categoryId), ...n.personIds.map(personName)].join(' ').toLowerCase();
    return hay.includes(q);
  });

  const byTitle = (a: Neta, b: Neta) => a.title.localeCompare(b.title, 'ja');
  list.sort((a, b) => {
    switch (netaSort) {
      case 'fresh':
        // 使っていないもの → 最後に使ったのが古いもの
        return (a.lastUsedAt || '0000').localeCompare(b.lastUsedAt || '0000') || b.createdAt - a.createdAt;
      case 'few':
        return a.useCount - b.useCount || b.createdAt - a.createdAt;
      case 'many':
        return b.useCount - a.useCount || b.createdAt - a.createdAt;
      case 'title':
        return byTitle(a, b);
      default:
        return b.createdAt - a.createdAt;
    }
  });
  return list;
}

function renderCategoryBar(): void {
  categoryBar.textContent = '';
  const isUncat = (n: Neta) => !n.categoryId || !categoryName(n.categoryId);
  const hasUncategorized = netas.some(isUncat);
  const valid = selectedCategory === ALL
    || (selectedCategory === UNCATEGORIZED && hasUncategorized)
    || categories.some((c) => c.id === selectedCategory);
  if (!valid) selectedCategory = ALL;

  const select = (id: string) => () => {
    selectedCategory = id;
    lsSet(CATEGORY_KEY, id);
    render();
  };
  categoryBar.append(chipButton('すべて', netas.length, selectedCategory === ALL, select(ALL)));
  categories.forEach((c) => {
    categoryBar.append(chipButton(c.name, netas.filter((n) => n.categoryId === c.id).length, selectedCategory === c.id, select(c.id)));
  });
  if (hasUncategorized) {
    categoryBar.append(chipButton('未分類', netas.filter(isUncat).length, selectedCategory === UNCATEGORIZED, select(UNCATEGORIZED)));
  }

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'category-chip category-chip--edit';
  edit.append(iconEl(svg(ICON_EDIT, 14)), textEl('span', '', 'カテゴリを編集'));
  edit.addEventListener('click', openCategoryEditor);
  categoryBar.append(edit);
}

function useText(n: Neta): string {
  if (!n.useCount) return 'まだ使っていない';
  const ago = agoText(n.lastUsedAt);
  return `${n.useCount}回使った` + (ago ? ` ・ 最後は${ago}` : '');
}

function renderNetaCard(n: Neta): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'neta-card' + (n.useCount === 0 ? ' is-new' : '');

  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'neta-card__btn';
  b.setAttribute('aria-label', `${n.title}の詳細を開く`);
  b.addEventListener('click', () => openNetaDetail(n.id));

  const cat = categoryName(n.categoryId);
  if (cat) b.append(textEl('span', 'chip chip--category', cat));
  b.append(textEl('h3', 'neta-card__title', n.title));
  if (n.body) b.append(textEl('p', 'neta-card__body', n.body));
  const names = n.personIds.map(personName).filter(Boolean);
  if (names.length) b.append(textEl('p', 'neta-card__for', `話したい：${names.join('、')}`));

  const foot = document.createElement('div');
  foot.className = 'neta-card__foot';
  foot.append(textEl('span', 'neta-card__use', useText(n)));
  const used = document.createElement('button');
  used.type = 'button';
  used.className = 'used-btn';
  used.setAttribute('aria-label', `${n.title}を使った`);
  used.append(iconEl(svg(ICON_CHECK, 14), ''), textEl('span', '', '使った'));
  used.addEventListener('click', () => void markUsed(n.id, used));
  foot.append(used);

  li.append(b, foot);
  return li;
}

function renderNetas(): void {
  renderCategoryBar();
  netaList.textContent = '';
  const list = filteredNetas();
  list.forEach((n) => netaList.append(renderNetaCard(n)));
  const unused = netas.filter((n) => n.useCount === 0).length;
  $('neta-summary').textContent = netas.length ? `${list.length}件 ・ まだ使っていないネタ ${unused}件` : '';
  $('neta-empty-first').classList.toggle('hidden', netas.length > 0);
  $('neta-empty-match').classList.toggle('hidden', netas.length === 0 || list.length > 0);
  $<HTMLButtonElement>('btn-omakase').disabled = netas.length === 0;
}

// ============================================================
// ひと一覧
// ============================================================
function filteredPersons(): Person[] {
  const q = personQuery.trim().toLowerCase();
  const list = persons.filter((p) => {
    if (selectedRelation !== ALL && p.relation !== selectedRelation) return false;
    if (!q) return true;
    const hay = [p.name, p.cautions, p.likes, p.memo, RELATION_LABEL[p.relation], ...p.logs.map((l) => l.text)]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
  const byName = (a: Person, b: Person) => a.name.localeCompare(b.name, 'ja');
  list.sort((a, b) => {
    switch (personSort) {
      case 'talked':
        return lastTalked(b).localeCompare(lastTalked(a)) || byName(a, b);
      case 'long':
        // 記録がない人 → 話したのが古い人
        return (lastTalked(a) || '0000').localeCompare(lastTalked(b) || '0000') || byName(a, b);
      case 'name':
        return byName(a, b);
      default:
        return b.updatedAt - a.updatedAt;
    }
  });
  return list;
}

function renderRelationBar(): void {
  relationBar.textContent = '';
  if (selectedRelation !== ALL && !RELATIONS.includes(selectedRelation as Relation)) selectedRelation = ALL;
  const select = (id: string) => () => {
    selectedRelation = id;
    lsSet(RELATION_KEY, id);
    render();
  };
  relationBar.append(chipButton('すべて', persons.length, selectedRelation === ALL, select(ALL)));
  RELATIONS.forEach((r) => {
    const count = persons.filter((p) => p.relation === r).length;
    if (count || selectedRelation === r) relationBar.append(chipButton(RELATION_LABEL[r], count, selectedRelation === r, select(r)));
  });
}

function renderPersonCard(p: Person): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'person-card';
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'person-card__btn';
  b.setAttribute('aria-label', `${p.name}の詳細を開く`);
  b.addEventListener('click', () => openPersonDetail(p.id));

  const head = document.createElement('div');
  head.className = 'person-card__head';
  head.append(textEl('h3', 'person-card__name', p.name), textEl('span', 'chip chip--relation', RELATION_LABEL[p.relation]));
  b.append(head);

  if (p.cautions.trim()) {
    const c = document.createElement('p');
    c.className = 'person-card__caution';
    c.append(iconEl(svg(ICON_CAUTION, 14), 'person-card__caution-icon'), textEl('span', '', p.cautions.trim()));
    b.append(c);
  }
  if (p.likes.trim()) b.append(textEl('p', 'person-card__likes', `好き：${p.likes.trim()}`));

  const meta: string[] = [];
  const count = netasFor(p.id).length;
  if (count) meta.push(`話したいネタ ${count}件`);
  const last = lastTalked(p);
  meta.push(last ? `最後に話した：${agoText(last) || formatDate(last)}` : 'まだ記録なし');
  b.append(textEl('p', 'person-card__meta', meta.join(' ・ ')));

  li.append(b);
  return li;
}

function renderPersons(): void {
  renderRelationBar();
  personList.textContent = '';
  const list = filteredPersons();
  list.forEach((p) => personList.append(renderPersonCard(p)));
  $('person-summary').textContent = persons.length ? `${list.length}人` : '';
  $('person-empty-first').classList.toggle('hidden', persons.length > 0);
  $('person-empty-match').classList.toggle('hidden', persons.length === 0 || list.length > 0);
}

function render(): void {
  if (!netasLoaded || !personsLoaded) return;
  loadingEl.classList.add('hidden');
  renderTabs();
  renderNetas();
  renderPersons();

  if (netaDetailId) {
    if (findNeta(netaDetailId)) renderNetaDetail();
    else closeNetaDetail();
  }
  if (personDetailId) {
    if (findPerson(personDetailId)) renderPersonDetail();
    else closePersonDetail();
  }
  if (omakaseId && !findNeta(omakaseId)) closeOverlay(omakaseOverlay);
}

// ============================================================
// ネタ：使った
// ============================================================
function markUsed(netaId: string, btn: HTMLButtonElement | null, person?: Person): Promise<void> {
  return guarded(`used:${netaId}`, btn, async () => {
    const n = findNeta(netaId);
    if (!currentUser || !n) return;
    await markNetaUsed(currentUser.uid, n, todayStr(), person);
    showToast(person ? `${person.name}との会話に記録しました` : `「${n.title}」を使いました（${n.useCount + 1}回目）`);
  });
}

// ============================================================
// ネタの詳細
// ============================================================
function openNetaDetail(id: string): void {
  if (!findNeta(id)) return;
  netaDetailId = id;
  renderNetaDetail();
  openOverlay(netaDetailOverlay);
}

function closeNetaDetail(): void {
  netaDetailId = null;
  closeOverlay(netaDetailOverlay);
}

function renderNetaDetail(): void {
  const n = findNeta(netaDetailId);
  if (!n) return;
  $('neta-detail-category').textContent = categoryName(n.categoryId) || '未分類';
  $('neta-detail-title').textContent = n.title;
  const meta: string[] = [];
  if (n.lastUsedAt) meta.push(`最後に使った日：${formatDate(n.lastUsedAt)}`);
  $('neta-detail-meta').textContent = meta.join(' ・ ');
  $('neta-detail-body').textContent = n.body;
  $('neta-detail-body-section').classList.toggle('hidden', !n.body);

  const wrap = $('neta-detail-persons');
  wrap.textContent = '';
  const ps = n.personIds.map(findPerson).filter((p): p is Person => !!p);
  if (!ps.length) {
    wrap.append(textEl('p', 'detail__empty', persons.length ? '「編集」から、このネタを話したい人を選べます。' : '「ひと」タブで人を登録すると、このネタを話したい人を選べます。'));
  }
  ps.forEach((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'person-chip';
    b.textContent = p.name;
    b.addEventListener('click', () => {
      closeNetaDetail();
      openPersonDetail(p.id);
    });
    wrap.append(b);
  });

  $('neta-detail-count').textContent = String(n.useCount);
  $('btn-neta-undo').classList.toggle('hidden', n.useCount === 0);
}

// ============================================================
// ネタの追加・編集
// ============================================================
function fillCategorySelect(selected: string): void {
  netaCategorySelect.textContent = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '未分類';
  netaCategorySelect.append(none);
  categories.forEach((c) => {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.name;
    netaCategorySelect.append(o);
  });
  netaCategorySelect.value = categories.some((c) => c.id === selected) ? selected : '';
}

function renderNetaPersonPicker(): void {
  netaPersonPicker.textContent = '';
  if (!persons.length) {
    netaPersonPicker.append(textEl('p', 'detail__empty', '「ひと」タブで人を登録すると、ここで選べるようになります。'));
    return;
  }
  [...persons].sort((a, b) => a.name.localeCompare(b.name, 'ja')).forEach((p) => {
    const on = netaEditorPersons.includes(p.id);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'person-chip' + (on ? ' is-active' : '');
    b.setAttribute('aria-pressed', String(on));
    b.textContent = p.name;
    b.addEventListener('click', () => {
      netaEditorPersons = on ? netaEditorPersons.filter((x) => x !== p.id) : [...netaEditorPersons, p.id];
      renderNetaPersonPicker();
    });
    netaPersonPicker.append(b);
  });
}

function netaEditorState(): string {
  return JSON.stringify([netaTitleInput.value, netaCategorySelect.value, netaBodyInput.value, [...netaEditorPersons].sort()]);
}

function openNetaEditor(id: string | null, presetPersonId = ''): void {
  const n = findNeta(id);
  editingNetaId = n ? n.id : null;
  $('neta-editor-title').textContent = n ? 'ネタを編集' : 'ネタを追加';
  netaTitleInput.value = n?.title ?? '';
  const defaultCat = !n && selectedCategory !== ALL && selectedCategory !== UNCATEGORIZED ? selectedCategory : '';
  fillCategorySelect(n ? n.categoryId : defaultCat);
  netaBodyInput.value = n?.body ?? '';
  netaEditorPersons = n ? n.personIds.filter((pid) => !!findPerson(pid)) : presetPersonId ? [presetPersonId] : [];
  renderNetaPersonPicker();
  activeEditor = 'neta';
  editorSnapshot = netaEditorState();
  openOverlay(netaEditorOverlay);
  if (!n) netaTitleInput.focus();
}

async function saveNeta(e: Event): Promise<void> {
  e.preventDefault();
  if (editorBusy || !currentUser) return;
  const title = netaTitleInput.value.trim();
  if (!title) {
    showToast('タイトルを入力してください');
    netaTitleInput.focus();
    return;
  }
  editorBusy = true;
  netaSaveBtn.disabled = true;
  netaSaveBtn.textContent = '保存中…';
  try {
    const data: NetaData = {
      title,
      categoryId: netaCategorySelect.value,
      body: netaBodyInput.value,
      personIds: netaEditorPersons.filter((pid) => !!findPerson(pid)),
    };
    const existing = findNeta(editingNetaId);
    if (existing) {
      await updateNeta(currentUser.uid, existing.id, data);
      showToast('保存しました');
    } else {
      await createNeta(currentUser.uid, data);
      showToast('ネタをポケットに入れました');
    }
    closeEditor();
  } catch (err) {
    console.error(err);
    showToast('保存に失敗しました。通信環境を確認してください');
  } finally {
    editorBusy = false;
    netaSaveBtn.disabled = false;
    netaSaveBtn.textContent = '保存する';
  }
}

// ============================================================
// おまかせ
// ============================================================
function pickOmakase(): void {
  const pool = filteredNetas();
  const source = pool.length ? pool : netas;
  if (!source.length) return;
  // まだ使っていない・しばらく使っていないネタを出やすくする
  const weight = (n: Neta) => (n.useCount === 0 ? 3 : (daysSince(n.lastUsedAt) ?? 0) >= 14 ? 2 : 1);
  const candidates = source.length > 1 ? source.filter((n) => n.id !== omakaseId) : source;
  const total = candidates.reduce((acc, n) => acc + weight(n), 0);
  let r = Math.random() * total;
  let picked = candidates[0];
  for (const n of candidates) {
    r -= weight(n);
    if (r < 0) {
      picked = n;
      break;
    }
  }
  omakaseId = picked.id;
  $('omakase-category').textContent = categoryName(picked.categoryId) || '未分類';
  $('omakase-title').textContent = picked.title;
  $('omakase-body').textContent = picked.body;
  $('omakase-meta').textContent = useText(picked);
  $('omakase-note').textContent = pool.length && selectedCategory !== ALL
    ? `「${selectedCategory === UNCATEGORIZED ? '未分類' : categoryName(selectedCategory)}」の中から選んでいます。`
    : 'まだ使っていないネタが出やすくなっています。';
  $<HTMLButtonElement>('btn-omakase-next').disabled = source.length < 2;
  openOverlay(omakaseOverlay);
}

// ============================================================
// ひとの詳細（会う前チェック）
// ============================================================
function openPersonDetail(id: string): void {
  if (!findPerson(id)) return;
  const switching = personDetailId !== id;
  personDetailId = id;
  if (switching) {
    logDateInput.value = todayStr();
    logDateInput.max = todayStr();
    logTextInput.value = '';
  }
  renderPersonDetail();
  openOverlay(personDetailOverlay);
}

function closePersonDetail(): void {
  personDetailId = null;
  closeOverlay(personDetailOverlay);
}

function renderPersonDetail(): void {
  const p = findPerson(personDetailId);
  if (!p) return;
  $('person-detail-relation').textContent = RELATION_LABEL[p.relation];
  $('person-detail-name').textContent = p.name;
  const last = lastTalked(p);
  $('person-detail-meta').textContent = last ? `最後に話した日：${formatDate(last)}（${agoText(last)}）` : '';

  $('person-detail-cautions').textContent = p.cautions.trim() || 'まだ書かれていません。「編集」から、NGな話題や苦手なものをメモできます。';
  $('person-detail-cautions-section').classList.toggle('is-empty', !p.cautions.trim());
  $('person-detail-likes').textContent = p.likes;
  $('person-detail-likes-section').classList.toggle('hidden', !p.likes.trim());
  $('person-detail-memo').textContent = p.memo;
  $('person-detail-memo-section').classList.toggle('hidden', !p.memo.trim());

  // 話したいネタ
  const ul = $<HTMLUListElement>('person-detail-netas');
  ul.textContent = '';
  const list = netasFor(p.id);
  if (!list.length) ul.append(textEl('li', 'detail__empty', 'ネタの「この人に話したい」で選ぶと、ここに並びます。'));
  list.forEach((n) => {
    const li = document.createElement('li');
    li.className = 'talk-neta';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'talk-neta__open';
    open.append(textEl('span', 'talk-neta__title', n.title));
    if (n.body) open.append(textEl('span', 'talk-neta__body', n.body));
    open.addEventListener('click', () => {
      closePersonDetail();
      openNetaDetail(n.id);
    });
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'used-btn';
    done.append(iconEl(svg(ICON_CHECK, 14), ''), textEl('span', '', '話した'));
    done.setAttribute('aria-label', `${n.title}を話した`);
    done.addEventListener('click', () => void markUsed(n.id, done, p));
    li.append(open, done);
    ul.append(li);
  });

  // 前回話したこと
  const logs = $<HTMLUListElement>('person-detail-logs');
  logs.textContent = '';
  if (!p.logs.length) logs.append(textEl('li', 'detail__empty', '話したことを記録しておくと、次に会うときの話題になります。'));
  p.logs.forEach((log) => {
    const li = document.createElement('li');
    li.className = 'log';
    li.append(textEl('span', 'log__date', `${formatDate(log.date)}`), textEl('span', 'log__text', log.text));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'icon-btn is-danger';
    del.setAttribute('aria-label', 'この記録を削除');
    del.append(iconEl(svg(ICON_TRASH, 16), ''));
    del.addEventListener('click', () => {
      askConfirm('記録を削除しますか？', `「${log.text}」を削除します。元に戻せません。`, async () => {
        if (!currentUser) return;
        await deleteTalkLog(currentUser.uid, p.id, log);
        showToast('記録を削除しました');
      });
    });
    li.append(del);
    logs.append(li);
  });
  const full = p.logs.length >= MAX_LOGS;
  logTextInput.disabled = full;
  $<HTMLButtonElement>('btn-log-add').disabled = full;
  logTextInput.placeholder = full ? `記録は${MAX_LOGS}件までです。古いものを削除してください` : '例：来月、引っ越すと言っていた';
}

async function addLog(e: Event): Promise<void> {
  e.preventDefault();
  const p = findPerson(personDetailId);
  if (!currentUser || !p) return;
  const text = logTextInput.value.trim();
  if (!text) {
    showToast('話したことを入力してください');
    logTextInput.focus();
    return;
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(logDateInput.value) ? logDateInput.value : todayStr();
  await guarded(`log:${p.id}`, $<HTMLButtonElement>('btn-log-add'), async () => {
    await addTalkLog(currentUser!.uid, p.id, date, text);
    logTextInput.value = '';
    showToast('記録しました');
  });
}

// ============================================================
// ひとの追加・編集
// ============================================================
function personEditorState(): string {
  return JSON.stringify([
    personNameInput.value, personRelationSelect.value, personCautionsInput.value, personLikesInput.value, personMemoInput.value,
  ]);
}

function openPersonEditor(id: string | null): void {
  const p = findPerson(id);
  editingPersonId = p ? p.id : null;
  $('person-editor-title').textContent = p ? '人を編集' : '人を追加';
  personNameInput.value = p?.name ?? '';
  personRelationSelect.textContent = '';
  RELATIONS.forEach((r) => {
    const o = document.createElement('option');
    o.value = r;
    o.textContent = RELATION_LABEL[r];
    personRelationSelect.append(o);
  });
  const defaultRel = !p && RELATIONS.includes(selectedRelation as Relation) ? (selectedRelation as Relation) : 'friend';
  personRelationSelect.value = p ? p.relation : defaultRel;
  personCautionsInput.value = p?.cautions ?? '';
  personLikesInput.value = p?.likes ?? '';
  personMemoInput.value = p?.memo ?? '';
  activeEditor = 'person';
  editorSnapshot = personEditorState();
  openOverlay(personEditorOverlay);
  if (!p) personNameInput.focus();
}

async function savePerson(e: Event): Promise<void> {
  e.preventDefault();
  if (editorBusy || !currentUser) return;
  const name = personNameInput.value.trim();
  if (!name) {
    showToast('名前を入力してください');
    personNameInput.focus();
    return;
  }
  editorBusy = true;
  personSaveBtn.disabled = true;
  personSaveBtn.textContent = '保存中…';
  try {
    const data: PersonData = {
      name,
      relation: personRelationSelect.value as Relation,
      cautions: personCautionsInput.value,
      likes: personLikesInput.value,
      memo: personMemoInput.value,
    };
    const existing = findPerson(editingPersonId);
    if (existing) {
      await updatePerson(currentUser.uid, existing.id, data);
      closeEditor();
      showToast('保存しました');
    } else {
      const id = await createPerson(currentUser.uid, data);
      closeEditor();
      showToast('登録しました');
      if (tab !== 'person') setTab('person');
      // 登録した人の詳細をそのまま開く
      personDetailId = id;
      logDateInput.value = todayStr();
      logDateInput.max = todayStr();
      logTextInput.value = '';
      if (findPerson(id)) renderPersonDetail();
      openOverlay(personDetailOverlay);
    }
  } catch (err) {
    console.error(err);
    showToast('保存に失敗しました。通信環境を確認してください');
  } finally {
    editorBusy = false;
    personSaveBtn.disabled = false;
    personSaveBtn.textContent = '保存する';
  }
}

// ============================================================
// 編集画面の共通処理
// ============================================================
function currentEditorState(): string {
  return activeEditor === 'neta' ? netaEditorState() : activeEditor === 'person' ? personEditorState() : '';
}

function requestCloseEditor(): void {
  if (editorBusy || !activeEditor) return;
  if (currentEditorState() !== editorSnapshot) openOverlay(discardOverlay);
  else closeEditor();
}

function closeEditor(): void {
  closeOverlay(netaEditorOverlay);
  closeOverlay(personEditorOverlay);
  closeOverlay(discardOverlay);
  editingNetaId = null;
  editingPersonId = null;
  netaEditorPersons = [];
  activeEditor = null;
}

// ============================================================
// カテゴリ編集
// ============================================================
function openCategoryEditor(): void {
  renderCategoryEditor();
  openOverlay(categoryOverlay);
}

function renderCategoryEditor(): void {
  const list = $<HTMLUListElement>('category-edit-list');
  list.textContent = '';
  if (!categories.length) list.append(textEl('li', 'category-edit__empty', 'カテゴリがありません。下の欄から追加できます。'));
  categories.forEach((c) => {
    const li = document.createElement('li');
    li.className = 'category-edit__row';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 20;
    input.value = c.name;
    input.setAttribute('aria-label', `${c.name}の名前`);
    const commit = async () => {
      const v = input.value.trim();
      if (!currentUser || v === c.name) return;
      if (!v) {
        input.value = c.name;
        return;
      }
      try {
        await renameCategory(currentUser.uid, c.id, v);
        showToast('名前を変更しました');
      } catch {
        input.value = c.name;
        showToast('変更に失敗しました');
      }
    };
    input.addEventListener('change', () => void commit());
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.isComposing) {
        ev.preventDefault();
        input.blur();
      }
    });
    const count = netas.filter((n) => n.categoryId === c.id).length;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'icon-btn is-danger';
    del.setAttribute('aria-label', `${c.name}を削除`);
    del.append(iconEl(svg(ICON_TRASH, 16), ''));
    del.addEventListener('click', () => {
      closeOverlay(categoryOverlay);
      askConfirm(
        'カテゴリを削除しますか？',
        count ? `「${c.name}」を削除します。中の${count}件のネタは「未分類」になります。` : `「${c.name}」を削除します。`,
        async () => {
          if (!currentUser) return;
          const ids = netas.filter((n) => n.categoryId === c.id).map((n) => n.id);
          await deleteCategory(currentUser.uid, c.id, ids);
          showToast('カテゴリを削除しました');
        },
      );
    });
    li.append(input, textEl('span', 'category-edit__count', `${count}件`), del);
    list.append(li);
  });
  const full = categories.length >= MAX_CATEGORIES;
  $<HTMLInputElement>('input-category-new').disabled = full;
  $<HTMLButtonElement>('btn-category-add').disabled = full;
}

async function addCategory(e: Event): Promise<void> {
  e.preventDefault();
  const input = $<HTMLInputElement>('input-category-new');
  const name = input.value.trim();
  if (!name || !currentUser) return;
  if (categories.some((c) => c.name === name)) {
    showToast('同じ名前のカテゴリがあります');
    return;
  }
  if (categories.length >= MAX_CATEGORIES) {
    showToast(`カテゴリは${MAX_CATEGORIES}個まで作れます`);
    return;
  }
  await guarded('category:add', $<HTMLButtonElement>('btn-category-add'), async () => {
    await createCategory(currentUser!.uid, name);
    input.value = '';
  }, '追加に失敗しました');
}

// ============================================================
// 確認ダイアログ（カスタムUI）
// ============================================================
function askConfirm(title: string, text: string, action: () => Promise<void>, okLabel = '削除する'): void {
  $('confirm-dialog-title').textContent = title;
  $('confirm-dialog-text').textContent = text;
  $('btn-confirm-delete').textContent = okLabel;
  confirmAction = action;
  openOverlay(confirmOverlay);
}

async function runConfirm(): Promise<void> {
  const action = confirmAction;
  if (!action) return;
  const btn = $<HTMLButtonElement>('btn-confirm-delete');
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    await action();
    confirmAction = null;
    closeOverlay(confirmOverlay);
  } catch {
    showToast('処理に失敗しました。もう一度お試しください');
  } finally {
    btn.disabled = false;
  }
}

// ============================================================
// サンプル
// ============================================================
async function addNetaSamples(btn: HTMLButtonElement): Promise<void> {
  await guarded('samples:neta', btn, async () => {
    if (!currentUser) return;
    for (const s of SAMPLE_NETAS) {
      const cat = categories.find((c) => c.name === s.categoryName);
      await createNeta(currentUser.uid, { title: s.title, body: s.body, categoryId: cat?.id ?? '', personIds: [] });
    }
    showToast('サンプルのネタを追加しました');
  }, '追加に失敗しました');
}

async function addPersonSample(btn: HTMLButtonElement): Promise<void> {
  await guarded('samples:person', btn, async () => {
    if (!currentUser) return;
    const d = new Date();
    d.setDate(d.getDate() - 10);
    const pad = (x: number) => String(x).padStart(2, '0');
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    await createPerson(currentUser.uid, SAMPLE_PERSON, [
      { id: newId(), date, text: '夏休みに家族でキャンプへ行った話を聞いた。次は紅葉の時期に行きたいらしい' },
    ]);
    showToast('サンプルの人を追加しました');
  }, '追加に失敗しました');
}

// ============================================================
// 認証
// ============================================================
function startSession(user: User): void {
  currentUser = user;
  loginScreen.classList.add('hidden');
  appEl.classList.remove('hidden');
  $('user-info').classList.remove('hidden');
  const avatar = $<HTMLImageElement>('user-avatar');
  if (user.photoURL) {
    avatar.src = user.photoURL;
    avatar.classList.remove('hidden');
  } else {
    avatar.classList.add('hidden');
  }
  $('user-name').textContent = user.displayName ?? '';

  const fail = (err: Error) => {
    console.error(err);
    loadingEl.classList.remove('hidden');
    loadingEl.textContent = 'データを読み込めませんでした。ページを再読み込みしてください。';
  };
  ensureDefaultCategories(user.uid).catch((err) => console.error(err));
  unsubs = [
    subscribeCategories(user.uid, (list) => {
      categories = list;
      render();
      if (categoryOverlay.classList.contains('is-open')) renderCategoryEditor();
    }, (err) => console.error(err)),
    subscribeNetas(user.uid, (list) => {
      netas = list;
      netasLoaded = true;
      render();
    }, fail),
    subscribePersons(user.uid, (list) => {
      persons = list;
      personsLoaded = true;
      render();
      if (netaEditorOverlay.classList.contains('is-open')) renderNetaPersonPicker();
    }, fail),
  ];
}

function endSession(): void {
  unsubs.forEach((u) => u());
  unsubs = [];
  currentUser = null;
  netas = [];
  persons = [];
  categories = [];
  netasLoaded = false;
  personsLoaded = false;
  netaList.textContent = '';
  personList.textContent = '';
  netaPanel.classList.add('hidden');
  personPanel.classList.add('hidden');
  loadingEl.classList.remove('hidden');
  loadingEl.textContent = '読み込み中…';
  [netaDetailOverlay, netaEditorOverlay, omakaseOverlay, personDetailOverlay, personEditorOverlay, categoryOverlay,
    discardOverlay, confirmOverlay].forEach(closeOverlay);
  netaDetailId = null;
  personDetailId = null;
  activeEditor = null;
  appEl.classList.add('hidden');
  loginScreen.classList.remove('hidden');
}

// ============================================================
// イベント
// ============================================================
function bindEvents(): void {
  let loginBusy = false;
  $('btn-google-login').addEventListener('click', async () => {
    if (loginBusy) return;
    loginBusy = true;
    try {
      await loginWithGoogle();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        showToast('ログインに失敗しました。ポップアップを許可して再度お試しください');
      }
    } finally {
      loginBusy = false;
    }
  });
  $('btn-logout').addEventListener('click', () => {
    logout().catch(() => showToast('ログアウトに失敗しました'));
  });

  tabNeta.addEventListener('click', () => setTab('neta'));
  tabPerson.addEventListener('click', () => setTab('person'));

  // ネタ一覧
  const netaSearch = $<HTMLInputElement>('input-neta-search');
  netaSearch.addEventListener('input', () => {
    netaQuery = netaSearch.value;
    render();
  });
  const netaSortSelect = $<HTMLSelectElement>('select-neta-sort');
  netaSortSelect.value = NETA_SORTS.includes(netaSort) ? netaSort : 'new';
  netaSort = netaSortSelect.value;
  netaSortSelect.addEventListener('change', () => {
    netaSort = netaSortSelect.value;
    lsSet(NETA_SORT_KEY, netaSort);
    render();
  });
  $('btn-neta-clear').addEventListener('click', () => {
    netaQuery = '';
    netaSearch.value = '';
    selectedCategory = ALL;
    lsSet(CATEGORY_KEY, ALL);
    render();
  });
  $('btn-neta-new').addEventListener('click', () => openNetaEditor(null));
  $('btn-neta-empty-new').addEventListener('click', () => openNetaEditor(null));
  $('btn-neta-samples').addEventListener('click', (e) => void addNetaSamples(e.currentTarget as HTMLButtonElement));
  $('btn-omakase').addEventListener('click', () => {
    omakaseId = null;
    pickOmakase();
  });

  // ひと一覧
  const personSearch = $<HTMLInputElement>('input-person-search');
  personSearch.addEventListener('input', () => {
    personQuery = personSearch.value;
    render();
  });
  const personSortSelect = $<HTMLSelectElement>('select-person-sort');
  personSortSelect.value = PERSON_SORTS.includes(personSort) ? personSort : 'updated';
  personSort = personSortSelect.value;
  personSortSelect.addEventListener('change', () => {
    personSort = personSortSelect.value;
    lsSet(PERSON_SORT_KEY, personSort);
    render();
  });
  $('btn-person-clear').addEventListener('click', () => {
    personQuery = '';
    personSearch.value = '';
    selectedRelation = ALL;
    lsSet(RELATION_KEY, ALL);
    render();
  });
  $('btn-person-new').addEventListener('click', () => openPersonEditor(null));
  $('btn-person-empty-new').addEventListener('click', () => openPersonEditor(null));
  $('btn-person-sample').addEventListener('click', (e) => void addPersonSample(e.currentTarget as HTMLButtonElement));

  // ネタの詳細
  $('btn-neta-detail-close').addEventListener('click', closeNetaDetail);
  $('btn-neta-detail-edit').addEventListener('click', () => openNetaEditor(netaDetailId));
  $('btn-neta-used').addEventListener('click', (e) => {
    if (netaDetailId) void markUsed(netaDetailId, e.currentTarget as HTMLButtonElement);
  });
  $('btn-neta-undo').addEventListener('click', (e) => {
    const n = findNeta(netaDetailId);
    if (!n || n.useCount === 0) return;
    void guarded(`undo:${n.id}`, e.currentTarget as HTMLButtonElement, async () => {
      await undoNetaUsed(currentUser!.uid, n.id);
      showToast('使った回数を1回戻しました');
    });
  });
  $('btn-neta-detail-delete').addEventListener('click', () => {
    const n = findNeta(netaDetailId);
    if (!n) return;
    askConfirm('ネタを削除しますか？', `「${n.title}」を削除します。元に戻せません。`, async () => {
      if (!currentUser) return;
      await deleteNeta(currentUser.uid, n.id);
      closeNetaDetail();
      showToast('削除しました');
    });
  });

  // ネタの編集
  $('neta-editor-form').addEventListener('submit', (e) => void saveNeta(e));
  $('btn-neta-editor-close').addEventListener('click', requestCloseEditor);
  $('btn-neta-editor-cancel').addEventListener('click', requestCloseEditor);

  // おまかせ
  $('btn-omakase-close').addEventListener('click', () => closeOverlay(omakaseOverlay));
  $('btn-omakase-next').addEventListener('click', pickOmakase);
  $('btn-omakase-used').addEventListener('click', async (e) => {
    if (!omakaseId) return;
    await markUsed(omakaseId, e.currentTarget as HTMLButtonElement);
    closeOverlay(omakaseOverlay);
  });

  // ひとの詳細
  $('btn-person-detail-close').addEventListener('click', closePersonDetail);
  $('btn-person-detail-edit').addEventListener('click', () => openPersonEditor(personDetailId));
  $('btn-person-add-neta').addEventListener('click', () => {
    if (personDetailId) openNetaEditor(null, personDetailId);
  });
  $('log-add-form').addEventListener('submit', (e) => void addLog(e));
  $('btn-person-detail-delete').addEventListener('click', () => {
    const p = findPerson(personDetailId);
    if (!p) return;
    askConfirm('この人を削除しますか？', `「${p.name}」と、気をつけること・話した記録・メモをすべて削除します。ネタは残ります。元に戻せません。`, async () => {
      if (!currentUser) return;
      await deletePerson(currentUser.uid, p.id, netasFor(p.id).map((n) => n.id));
      closePersonDetail();
      showToast('削除しました');
    });
  });

  // ひとの編集
  $('person-editor-form').addEventListener('submit', (e) => void savePerson(e));
  $('btn-person-editor-close').addEventListener('click', requestCloseEditor);
  $('btn-person-editor-cancel').addEventListener('click', requestCloseEditor);
  $('btn-discard-cancel').addEventListener('click', () => closeOverlay(discardOverlay));
  $('btn-discard-ok').addEventListener('click', closeEditor);

  // カテゴリ
  $('btn-category-close').addEventListener('click', () => closeOverlay(categoryOverlay));
  $('category-add-form').addEventListener('submit', (e) => void addCategory(e));

  // 確認ダイアログ
  $('btn-confirm-cancel').addEventListener('click', () => {
    confirmAction = null;
    closeOverlay(confirmOverlay);
  });
  $('btn-confirm-delete').addEventListener('click', () => void runConfirm());

  // フィードバック
  const fbInput = $<HTMLTextAreaElement>('input-feedback-message');
  const fbSend = $<HTMLButtonElement>('btn-feedback-send');
  $('feedback-btn').addEventListener('click', () => {
    openOverlay(feedbackOverlay);
    fbInput.focus();
  });
  $('btn-feedback-close').addEventListener('click', () => closeOverlay(feedbackOverlay));
  fbSend.addEventListener('click', async () => {
    const msg = fbInput.value.trim();
    if (!msg) {
      showToast('内容を入力してください');
      return;
    }
    if (fbSend.disabled) return;
    fbSend.disabled = true;
    fbSend.textContent = '送信中…';
    const ok = await submitFeedback(msg);
    fbSend.disabled = false;
    fbSend.textContent = '送信する';
    if (ok) {
      fbInput.value = '';
      closeOverlay(feedbackOverlay);
      showToast('送信しました。ありがとうございます！');
    } else {
      showToast('送信に失敗しました。時間をおいてお試しください');
    }
  });

  // 背景クリック・Escで閉じる（編集中のものは確認を挟む）
  const closers: [HTMLElement, () => void][] = [
    [netaDetailOverlay, closeNetaDetail],
    [personDetailOverlay, closePersonDetail],
    [omakaseOverlay, () => closeOverlay(omakaseOverlay)],
    [netaEditorOverlay, requestCloseEditor],
    [personEditorOverlay, requestCloseEditor],
    [categoryOverlay, () => closeOverlay(categoryOverlay)],
    [discardOverlay, () => closeOverlay(discardOverlay)],
    [confirmOverlay, () => { confirmAction = null; closeOverlay(confirmOverlay); }],
    [feedbackOverlay, () => closeOverlay(feedbackOverlay)],
  ];
  closers.forEach(([overlay, close]) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // 一番手前（DOM上で最後）に開いているものだけ閉じる
    const opened = Array.from(document.querySelectorAll<HTMLElement>('.dialog-overlay.is-open'));
    const top = opened[opened.length - 1];
    closers.find(([o]) => o === top)?.[1]();
  });
}

bindEvents();
onAuthChange((user) => {
  if (user) {
    if (currentUser?.uid !== user.uid) {
      if (currentUser) endSession();
      startSession(user);
    }
  } else if (currentUser) {
    endSession();
  }
});
