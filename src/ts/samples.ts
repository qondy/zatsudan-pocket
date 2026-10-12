import { PersonData } from './types';

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
