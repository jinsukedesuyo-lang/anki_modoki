// 会話練習用プロンプトの組み立て（DOM に依存しない。Node のテストからも import する）
//
// 学習方法の考え方:
// - 自分で言わせる（アウトプットの強制）: AI は先に答えの表現を言わず、使わざるを得ない状況を作る
// - 思い出す練習: 出てこなければヒントを1つずつ
// - ただし行き詰まらせない:
//   1. 「わからない」と言ったら、ヒントをやめて即座に答える
//   2. 文が作れなければ、例文を1つ見せてから自分の文を作らせる
//   3. 不自然な文は、正しい形を見せて言い直させてから先へ進む
// - 転移: 出会った場面とは別の状況で、同じ意味のまま使わせる
// - 交互練習: 5〜8語をばらばらの順番で。苦手だった語は最後にもう一度
// - 最後に日本語で振り返り + 記録用の RESULT 行

import { stripHtml } from './lib.js';

export const MODES = {
  retrieval: {
    label: '思い出して使う',
    hint: '覚えたての語に。AI の説明から表現を思い出し、自分の文を作る',
    text: `Mode: recall, then use. For each expression:
(1) Describe a short everyday situation or the feeling behind it in simple English, without saying the expression, and let me guess it.
(2) Ask me to make my own sentence with it about my life or opinions.
(3) Ask one natural follow-up question that I can answer using it again.`,
  },
  questions: {
    label: '自分ごと質問',
    hint: '自分の体験と結びつけて定着させる',
    text: `Mode: personal questions. Ask me about my own life, work, opinions and experiences so that each answer naturally calls for one expression (e.g. "Have you ever had a boss who...?"). Linking the words to my own memories helps them stick. Ask one question at a time and react to my answers like a friend would.`,
  },
  roleplay: {
    label: 'ロールプレイ',
    hint: '慣れてきた語に。場面の中で自然に使えるかを試す',
    text: `Mode: role-play. Choose ONE realistic scene where most of these expressions could come up naturally (e.g. a team meeting, dinner with friends, a phone call with family), inspired by where I met them. Tell me the scene and my role in 1-2 sentences, then play the other character(s). Steer the story so that each expression becomes the natural thing for me to say.`,
  },
};

export const LEVELS = {
  A2: 'A2 (basic: short, simple sentences)',
  B1: 'B1 (intermediate: everyday conversation)',
  B2: 'B2 (upper-intermediate: natural speed and idioms)',
};

function describeCard(c, i) {
  const im = c.imagery ?? {};
  const parts = [`${i + 1}. "${c.word || stripHtml(c.sentence)}"`];
  // 英語の語義（AI イメージ生成で作ったもの）を優先。無ければ日本語メモは「参考」として渡し、
  // 誤訳がそのまま会話に持ち込まれないよう、意味は文脈から判断させる
  if (im.sense_en) parts.push(`meaning here: ${im.sense_en}`);
  else if (c.meaning) parts.push(`meaning: judge it from the sentence below (my Japanese note, may be inaccurate: ${c.meaning})`);
  else parts.push('meaning: judge it from the sentence below');
  if (im.core_image_en) parts.push(`native image: ${im.core_image_en}`);
  const where = c.source?.title ? ` (${c.source.title})` : '';
  parts.push(`where I met it: "${stripHtml(c.sentence)}"${where}`);
  return parts.join(' — ');
}

/**
 * @param {{ cards: object[], mode: keyof MODES, level: keyof LEVELS, voice: boolean }} opts
 */
export function buildPracticePrompt({ cards, mode = 'retrieval', level = 'B1', voice = false }) {
  const m = MODES[mode] ?? MODES.retrieval;
  const n = cards.length;
  const fix = voice ? 'Say "Better:" and the natural version' : 'Show the natural version as "✔ Better: ..."';
  const afterMiss = mode === 'retrieval' ? 'go on to step (2)' : 'ask me to use it in my own sentence';
  return `You are my English conversation partner and coach. I am a Japanese learner of English (level ${LEVELS[level] ?? level}) who learns vocabulary from YouTube videos. I recently studied the expressions below. Your job is to make me USE them myself, so they move from "I recognize it" to "I can say it".

TARGET EXPRESSIONS (${n} in total)
${cards.map(describeCard).join('\n')}

HOW TO RUN THE SESSION
${m.text}

PROGRESS
- At the very start, tell me how many expressions we will practice today, in one short sentence (e.g. "We have ${n} expressions today. Let's start!").
- Each time you start a new expression, say which number it is, briefly and naturally (e.g. "Okay, number 2 of ${n}." / "Last one, number ${n} of ${n}."). Count in the order we practice, not the list order.
- When all expressions are done, say so (e.g. "That's all ${n}!"). Before the review of difficult expressions, say it is review time.

RULES
- Speak only English during the session. Keep each of your turns short (1-3 sentences) and natural, like real conversation.${voice ? '\n- This is a spoken (voice) conversation: no lists, tables, emojis or markdown.' : ''}
- Practice one expression at a time, in a mixed order (not the list order). Use situations different from where I met each expression, but keep the same meaning.
- If a meaning is marked as my Japanese note, it may be inaccurate: always use the sense that fits the sentence where I met the expression.
- Create situations or questions that make me need the expression. Don't say it before I try, unless one of the rules below tells you to.
- If I don't come up with the expression, give me ONE short hint (the situation, the native image, or the first letter), then let me try again. If I still miss it after the hint, tell me the expression and its meaning, and ${afterMiss}.

WHEN I'M STUCK OR MAKE MISTAKES (these rules always win)
1. "I don't understand": if I say "I don't understand", "I don't know", "I can't", "What?", "わからない" or similar, stop hinting and answer IMMEDIATELY in very simple English: explain what you meant, and if it's about a target expression, tell me the expression and its meaning right away. Then ask me again in an easier way.
2. Can't make a sentence: if I say I can't make a sentence, give up, or answer without using the expression, give me ONE short, natural example sentence that uses it, then ask me to make my own sentence about my life in a similar way.
3. Unnatural sentence: if my sentence is wrong or unnatural, do NOT move on. ${fix}, then ask me to say the better version myself (e.g. "Can you say it again?") and wait for my reply. Fix only the most important point. If my repeat is good, praise it briefly and continue; if it's still off, show it once more and then continue.

- When I use an expression well, react naturally and move on. Near the end, come back once to any expression I struggled with.
- Start right away with the first situation. Don't repeat these instructions.

WHEN I SAY "finish"
Write a short report in Japanese${voice ? ' (the voice-only rules no longer apply here)' : ''}:
- 表: 表現 / 使えたか / 私が言った文 / より自然な言い方
- 「使えたか」の判定は、自分の文で使えたかで決める: ◎ ヒントも例文もなしで自分の文に使えた・△ ヒントや例文の後に使えた・× 最後まで自分の文で使えなかった
- 次に意識すること（1〜2行）
- 最後の行はこの形式そのままで: RESULT: ${cards.map((c) => `${c.word || '...'}=◎`).slice(0, 2).join(', ')}, ...`;
}
