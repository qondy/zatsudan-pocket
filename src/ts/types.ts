/** 話のネタ */
export interface NetaData {
  title: string;
  body: string; // くわしい内容・話の流れ
  categoryId: string; // '' は未分類
  personIds: string[]; // この人に話したい
}

export interface Neta extends NetaData {
  id: string;
  useCount: number; // 使った回数
  lastUsedAt: string; // 最後に使った日 'YYYY-MM-DD' または ''
  createdAt: number;
  updatedAt: number;
}

/** 相手との関係 */
export type Relation = 'work' | 'friend' | 'family' | 'neighbor' | 'other';

/** 「前回話したこと」の記録 */
export interface TalkLog {
  id: string;
  date: string; // 'YYYY-MM-DD'
  text: string;
}

export interface PersonData {
  name: string;
  relation: Relation;
  cautions: string; // 気をつけること（NG話題・苦手なもの など）
  likes: string; // 好きなもの・関心ごと
  memo: string; // その他のメモ
}

export interface Person extends PersonData {
  id: string;
  logs: TalkLog[]; // 新しい順
  createdAt: number;
  updatedAt: number;
}

export interface Category {
  id: string;
  name: string;
  createdAt: number;
}

/** ナレッジの種類 */
export type KnowledgeKind = 'listen' | 'talk' | 'care' | 'trouble' | 'mind' | 'other';

/** コミュニケーションで大切なこと・ナレッジ */
export interface KnowledgeData {
  title: string;
  body: string;
  kind: KnowledgeKind;
  source: string; // どこで知ったか（本・人・経験など）
  important: boolean; // 大事（★）
}

export interface Knowledge extends KnowledgeData {
  id: string;
  createdAt: number;
  updatedAt: number;
}
