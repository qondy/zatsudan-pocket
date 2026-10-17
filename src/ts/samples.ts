import { KnowledgeData, PersonData } from './types';

export interface SampleNeta {
  title: string;
  categoryName: string;
  body: string;
}

export const SAMPLE_NETAS: SampleNeta[] = [
  {
    title: '最近いちばんおいしかったもの',
    categoryName: '質問ネタ',
    body: '「最近食べた中でいちばんおいしかったものは？」と聞く。\n自分の答え：駅前の新しいパン屋のカレーパン。お店の話や好きな食べ物の話に広げやすい。',
  },
  {
    title: '傘を3本なくした話',
    categoryName: '鉄板ネタ',
    body: '1か月で傘を3本なくした話。最後は傘立てに名前を書いたら戻ってきた、というオチ。\n相手の「なくし物あるある」を聞くと盛り上がる。',
  },
  {
    title: '休みの日の過ごし方',
    categoryName: '雑談',
    body: '週末どう過ごしているかを聞く。趣味・家族・行きたい場所の話につながる。\n自分の話：朝の散歩コースを開拓中。',
  },
];

export const SAMPLE_PERSON: PersonData = {
  name: '（サンプル）佐藤さん',
  relation: 'work',
  cautions: '・お酒の話はしない（飲まない）\n・朝は忙しそうなので、話しかけるのは午後に\n・プライベートの質問は深追いしない',
  likes: '・キャンプ（夏に家族で行っている）\n・コーヒー（浅煎りが好き）\n・サッカー観戦',
  memo: '誕生日は5月。甘いものより、しょっぱいお菓子派。',
};

export const SAMPLE_KNOWLEDGES: KnowledgeData[] = [
  {
    title: '話すより、まず聞く',
    kind: 'listen',
    body: '相手が話し終わるまで口をはさまない。\n「それで？」「どうなったの？」と続きをうながすと、相手は気持ちよく話せる。\n自分の話は、聞かれてからで十分。',
    source: '経験から',
    important: true,
  },
  {
    title: '名前を呼んで話しかける',
    kind: 'talk',
    body: '「おはようございます」より「佐藤さん、おはようございます」。\n名前を呼ぶだけで、距離がぐっと縮まる。',
    source: '本で読んだ',
    important: false,
  },
  {
    title: '沈黙はこわくない',
    kind: 'trouble',
    body: '会話が止まっても、あせって話題を探さなくていい。\n困ったら、目の前のもの（天気・食べ物・場所）について聞いてみる。',
    source: '',
    important: false,
  },
];
