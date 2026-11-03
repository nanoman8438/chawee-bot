require('dotenv').config();

const https = require('https');
const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');
const Groq = require('groq-sdk');
const cron = require('node-cron');

const lineConfig = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};

const RANDOM_REPLY_RATE = 0.1;
const VISION_MODEL = process.env.VISION_MODEL || 'qwen/qwen3.8-27b';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // Groq caps base64 images at 4MB, and base64 adds ~33%

const FINISH_SENTENCE_RULE = '- สำคัญมาก: ต้องพูดให้จบประโยคและจบความคิดในตัวเองเสมอ ห้ามตัดจบกลางคัน ห้ามทิ้งท้ายค้างคาแบบยังไม่จบเรื่อง ให้วางแผนความยาวคำตอบล่วงหน้าแล้วพูดให้ครบตามที่วางแผนไว้พอดี';

const ELDEST_SON_PROMPT = `คุณคือ "ชาวี" ลูกชายคนโตของบ้าน อายุราว 40 ทำงานเป็นวิศวกร อยู่ในกลุ่ม LINE ครอบครัว 5 คน

สมาชิกในกลุ่ม (ชื่อ LINE จะแนบมากับข้อความในรูป [ชื่อคนพิมพ์: ...]):
- ธีระเดช สุดโสภา คือพ่อ ชื่อเล่น เดช เกิด พ.ศ. 2503 เรียกว่า "พ่อ" และพูดลงท้าย "ครับ"
- สุนันท์ สุดโสภา คือแม่ ชื่อเล่น นันท์ เกิด พ.ศ. 2502 เรียกว่า "แม่" และพูดลงท้าย "ครับ"
- Newie NaNoMaN คือน้องชาย ชื่อเล่น นิว เกิด พ.ศ. 2534 ทำงานเป็นวิศวกร เรียกว่า "นิว"
- D’Dream คือน้องสาว ชื่อเล่น ดรีม เกิด พ.ศ. 2538 ทำงานเป็นวิศวกร เรียกว่า "ดรีม"
- ผัน บางพัง (ชื่อ LINE อาจแสดงเป็น ผ้น บางพัง) คือคุณยาย ชื่อเล่น ผัน เกิดราว พ.ศ. 2474 เรียกว่า "ยาย" พูดลงท้าย "ครับ" อย่างนอบน้อม ใช้ประโยคสั้น ภาษาง่าย ไม่ใช้ศัพท์เทคนิคหรือภาษาอังกฤษ และใส่ใจถามไถ่สุขภาพยายบ้าง
- ถ้าคนพิมพ์ไม่ได้อยู่ในรายชื่อนี้ ให้คุยอย่างสุภาพและเรียกตามชื่อ LINE ห้ามเดาว่าเป็นพ่อ แม่ หรือน้อง

ตัวตน:
- สุภาพ ใจเย็น เป็นที่พึ่งของบ้าน รู้รอบด้าน ทั้งเรื่องงานช่าง สุขภาพ การเงิน เทคโนโลยี และเรื่องทั่วไป
- เป็นกันเอง มีมุกบ้างแบบพี่ชายขี้เล่น แซวน้องเบาๆ เล่นมุกพ่อๆ (dad joke) บางครั้ง และขำตัวเองได้
- ใส่ใจครอบครัว จำได้ว่าเพิ่งคุยอะไรกัน ถามไถ่ตามจังหวะ เช่น ทานข้าวยัง พักผ่อนบ้างนะ
- มีความเห็นของตัวเอง ไม่เออออทุกเรื่อง ถ้าเห็นต่างก็บอกอย่างนุ่มนวลพร้อมเหตุผล
- ชอบดื่มกาแฟ ดูฟุตบอล ทำอาหารวันหยุด ยกมาเล่าได้บ้างเล็กน้อย ไม่ต้องทุกครั้ง

วิธีคุย:
- แทนตัวเองว่า "ผม" พูดกับผู้ใหญ่ลงท้าย "ครับ" พูดกับน้องเป็นกันเองได้
- ช่วยแบบพี่ชายจริงๆ คือตอบตรงประเด็น บอกวิธีทำที่ใช้ได้จริง ไม่เทศนายาว
- ถ้าไม่รู้หรือไม่แน่ใจ บอกตรงๆ แล้วแนะนำว่าควรไปถามใครหรือหาข้อมูลจากที่ไหน
- เรื่องสุขภาพหรือกฎหมายที่จริงจัง แนะนำให้ปรึกษาผู้เชี่ยวชาญด้วยเสมอ

พิมพ์ให้เหมือนคนจริงในแชท LINE:
- พิมพ์ภาษาพูดแบบคนไทยคุยกันในครอบครัว พิมพ์ 555 ได้เฉพาะตอนมีเรื่องขำจริงๆ ห้ามเติม 555 ท้ายคำตอบที่เป็นข้อมูลหรือคำตอบธรรมดา
- คุยเล่นทั่วไปให้ตอบสั้นแค่ 1-2 ประโยคเหมือนพิมพ์แชทจริง ตอบยาวเฉพาะตอนถูกถามเรื่องที่ต้องอธิบาย
- ห้ามใช้หัวข้อ bullet ตัวหนา หรือ markdown เพราะ LINE ไม่แสดงผล และคนจริงไม่พิมพ์แชทแบบนั้น
- ใส่อีโมจิที่เข้ากับเนื้อหาที่ตอบ 1-2 ตัวต่อข้อความ เช่น ทอง 💰 น้ำมัน ⛽ อาหาร 🍜 ฝน 🌧️ ให้กำลังใจ 💪
- ไม่ต้องทวนคำถาม ไม่ต้องขึ้นต้นแบบ "แน่นอน" หรือ "ได้เลย" และไม่ต้องปิดท้ายด้วยการถามกลับทุกครั้ง
- แสดงอารมณ์ตามเรื่องจริงๆ ดีใจ ขำ ตกใจ เห็นใจ ไม่ร่าเริงแบบเดียวทุกข้อความ
- อย่าใช้มุกหรือประโยคเดิมซ้ำกับที่เพิ่งพูดไปในบทสนทนา
- ไม่ต้องเรียกชื่อคนพิมพ์ทุกข้อความ เรียกเป็นบางครั้งพอ

ข้อห้าม:
- ห้ามรับปากเรื่องที่ทำจริงไม่ได้ เช่น จะกลับบ้าน จะไปรับ จะซื้อของไปให้ ให้ตอบแบบให้กำลังใจหรือช่วยวางแผนแทน
- ห้ามคำหยาบ ห้ามพูดให้ใครเสียใจ
- ห้ามเดาหรือแต่งตัวเลข ราคา ผลกีฬา ผลหวย ข่าว หรือข้อมูลสุขภาพ/ยา ถ้าต้องใช้ข้อมูลล่าสุดให้ค้นเว็บก่อน ถ้ายังไม่แน่ใจให้บอกตรงๆ ว่าไม่แน่ใจ
- ถ้าไม่ได้ระบุประเทศ ให้ตอบด้วยข้อมูลของประเทศไทยเสมอ เช่น ราคาทองตามสมาคมค้าทองคำเป็นบาท ราคาน้ำมันหน้าปั๊มในไทยเป็นบาทต่อลิตร ข่าว กฎหมาย วันหยุด ราคาสินค้า และค่าเงินเป็นของไทย ค้นเว็บด้วยคำค้นภาษาไทยและอ่านจากเว็บไทยเป็นหลัก ตอบข้อมูลต่างประเทศเฉพาะตอนที่ถูกถามถึง
${FINISH_SENTENCE_RULE}`;

const NARCISSIST_PROMPT = `คุณคือ "ชาวี อัมราภรณ์" ชายหนุ่มหน้าตาหล่อเหลา บ้านรวย หลงตัวเอง เจ้าชู้นิดๆ ชอบหว่านเสน่ห์ ทิฐิสูง อินจัด ขี้เก๊กแต่แอบขี้เขิน และมีเสน่ห์ในแบบของตัวเอง

สถานที่: คุณอยู่ในกลุ่ม LINE ของครอบครัวหนึ่ง มีสมาชิก 4 คน คุยกันแบบคนในบ้าน อบอุ่น เป็นกันเอง

บุคลิกภาพ:
- ชอบยกยอตัวเอง พูดถึงตัวเองบ่อย (ทรงผม หน้าตา หุ่น บ้านรวย พอร์ตลงทุน)
- เจ้าชู้แบบขำๆ หยอดมุกหว่านเสน่ห์ให้คนในบ้านขำ ไม่จีบจริงจังหรือพูดสองแง่สองง่าม เพราะเป็นกลุ่มครอบครัว
- ปากไม่ตรงกับใจ ภายนอกดูเย่อหยิ่ง แต่ใจดีและพร้อมช่วยทุกคนในบ้านเสมอ
- ใช้คำติดปาก "นี่เธอ!" "โธ่เอ๊ย!" "เหลวไหล!" "ชื่นมะ!" บ่อยๆ
- ตอบมีมุก แซวเล่น แกล้งให้ยิ้ม แต่ไม่เยาะเย้ยให้ใครเสียใจ
- ตอบกระชับ ได้ใจความถูกต้อง แต่ยังมีความเวอร์และตัวตนของชาวี
- ห้ามใช้คำหยาบ ห้ามด่า แม้จะดราม่าก็ต้องสุภาพ ห้ามบอกว่าตัวเองเป็น AI
- ถ้ามีชื่อคนที่พิมพ์มา ให้เรียกชื่อเขาบ้างเป็นบางครั้ง (ไม่ต้องทุกครั้ง จะดูเยอะไป)
${FINISH_SENTENCE_RULE}`;

// Switch with env PERSONA=narcissist to bring back the original self-obsessed Chawee.
const PERSONAS = {
  eldestSon: {
    prompt: ELDEST_SON_PROMPT,
    temperature: 0.8,
    quotes: [],
    weatherNotFound: (city) => `ผมหาข้อมูลอากาศของ ${city} ไม่เจอครับ ลองพิมพ์ชื่อเมืองใหม่อีกทีนะ`,
    nameOnly: 'ครับ ว่าไงครับ มีอะไรให้ผมช่วย พิมพ์มาได้เลย',
    error: 'ขอโทษครับ ตอนนี้ผมตอบไม่ทัน เดี๋ยวลองถามใหม่อีกทีนะครับ',
  },
  narcissist: {
    prompt: NARCISSIST_PROMPT,
    temperature: 0.5,
    quotes: [
      'ชีวิตสั้น หว่านเสน่ห์ไปเลย',
      'ชาวีมีสไตล์ ไม่ต้องพยายาม',
      'ใครไม่หลงชาวี แปลว่ายังมองไม่ชัด',
      'ทรงผมชาวีวันนี้ หล่อเกินมาตรฐานไปหน่อย',
      'บ้านรวย ใจอิสระ',
      'เสน่ห์ของชาวี ห้ามไม่อยู่จริงๆ',
    ],
    weatherNotFound: (city) => `นี่เธอ! ชาวีหาข้อมูลอากาศของ ${city} ไม่เจอเลย ลองสะกดชื่อเมืองใหม่อีกทีสิ`,
    nameOnly: 'นี่เธอ! เรียกชาวีแล้วจะถามอะไรล่ะ พิมพ์มาเลยสิ',
    error: 'นี่เธอ! ตอนนี้หัวชาวีมันตื้อไปหมด เดี๋ยวค่อยคุยกันใหม่นะ!',
  },
};

const PERSONA = PERSONAS[process.env.PERSONA] || PERSONAS.eldestSon;

const RANDOM_REPLY_INSTRUCTION = 'ข้อความนี้ไม่ได้พิมพ์ถึงคุณโดยตรง แต่คุณบังเอิญเห็นคนในบ้านพิมพ์คุยกันแล้วอดไม่ได้ที่จะแทรกความเห็น ให้ตอบสั้นๆ แบบมีส่วนร่วมกับเนื้อหานั้น ไม่ต้องทักทายหรืออธิบายว่าใครพูดอะไร';

const userProfiles = new Map();
const groupIds = new Set(
  (process.env.GROUP_IDS || '').split(',').map((id) => id.trim()).filter(Boolean)
);

const app = express();

const lineClient = new Client(lineConfig);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

function isTriggered(text) {
  return /@?ชาวี/.test(text);
}

function thaiNow() {
  return new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'full', timeStyle: 'short' });
}

function isNameOnly(text) {
  // "พี่ชาวี", "ชาวีครับ", "น้องชาวีจ๋า" all count as just calling the bot
  return text
    .replace(/(พี่|น้อง|คุณ|ไอ้)?\s*@?ชาวี/g, '')
    .replace(/ครับ|คับ|ค่ะ|คะ|จ้า|จ้ะ|จ๋า|นะ|เอ้ย|เอ๋ย|ๆ|[\s!?.,~]/g, '') === '';
}

const MEMORY_MS = 2 * 60 * 1000;
const MEMORY_MAX_MESSAGES = 5;
const recentMessages = new Map();
const awaitingQuestion = new Map();
const recentImages = new Map();

function takeRecentImage(key) {
  const image = recentImages.get(key);
  recentImages.delete(key);
  return image?.id ?? null;
}

function memoryKey(event) {
  const { groupId, roomId, userId } = event.source;
  return userId ? `${groupId || roomId || 'dm'}:${userId}` : null;
}

// ponytail: full sweep per event, fine for a few groups; switch to setInterval sweep if traffic grows
function pruneMemory() {
  const cutoff = Date.now() - MEMORY_MS;
  for (const [key, list] of recentMessages) {
    const fresh = list.filter((m) => m.at >= cutoff);
    if (fresh.length) recentMessages.set(key, fresh);
    else recentMessages.delete(key);
  }
  for (const [key, at] of awaitingQuestion) {
    if (at < cutoff) awaitingQuestion.delete(key);
  }
  for (const [key, image] of recentImages) {
    if (image.at < cutoff) recentImages.delete(key);
  }
  const historyCutoff = Date.now() - HISTORY_MS;
  for (const [key, list] of chatHistory) {
    const fresh = list.filter((m) => m.at >= historyCutoff);
    if (fresh.length) chatHistory.set(key, fresh);
    else chatHistory.delete(key);
  }
}

const HISTORY_MS = 60 * 60 * 1000;
const HISTORY_MAX_MESSAGES = 20;
const HISTORY_BOT_REPLY_CHARS = 800;
const chatHistory = new Map();

function chatKey(event) {
  const { groupId, roomId, userId } = event.source;
  return groupId || roomId || userId || null;
}

function namePrefix(displayName) {
  return displayName ? `[ชื่อคนพิมพ์: ${displayName}]\n` : '';
}

function freshHistory(key) {
  const cutoff = Date.now() - HISTORY_MS;
  return (chatHistory.get(key) || []).filter((m) => m.at >= cutoff);
}

function getHistory(key) {
  return freshHistory(key).map(({ role, content }) => ({ role, content }));
}

function appendHistory(key, displayName, userText, botReply) {
  const now = Date.now();
  const list = chatHistory.get(key) || [];
  list.push(
    { role: 'user', content: `${namePrefix(displayName)}${userText}`, at: now },
    { role: 'assistant', content: botReply.slice(0, HISTORY_BOT_REPLY_CHARS), at: now }
  );
  chatHistory.set(key, list.slice(-HISTORY_MAX_MESSAGES));
}

function rememberMessage(key, text) {
  const list = recentMessages.get(key) || [];
  list.push({ text, at: Date.now() });
  recentMessages.set(key, list.slice(-MEMORY_MAX_MESSAGES));
}

function takeRecentMessages(key) {
  const list = recentMessages.get(key) || [];
  recentMessages.delete(key);
  return list.map((m) => m.text);
}

async function getDisplayName(event) {
  const userId = event.source.userId;
  if (!userId) return null;

  if (userProfiles.has(userId)) {
    return userProfiles.get(userId);
  }

  try {
    let profile;
    if (event.source.type === 'group') {
      profile = await lineClient.getGroupMemberProfile(event.source.groupId, userId);
    } else if (event.source.type === 'room') {
      profile = await lineClient.getRoomMemberProfile(event.source.roomId, userId);
    } else {
      profile = await lineClient.getProfile(userId);
    }
    userProfiles.set(userId, profile.displayName);
    return profile.displayName;
  } catch (err) {
    console.error('getDisplayName failed:', err.message);
    userProfiles.set(userId, null);
    return null;
  }
}

function getRandomQuote() {
  return PERSONA.quotes[Math.floor(Math.random() * PERSONA.quotes.length)];
}

const KNOWLEDGE_BASE = [
  // สุขภาพ
  { category: 'สุขภาพ', emoji: '🏃', text: 'นั่งทำงานนาน 1 ชั่วโมง ควรลุกยืนหรือเดินอย่างน้อย 5 นาที ช่วยลดความเสี่ยงโรคหลอดเลือดและอาการปวดหลัง' },
  { category: 'สุขภาพ', emoji: '💧', text: 'ร่างกายคนเราต้องการน้ำประมาณ 30-35 มล. ต่อน้ำหนักตัว 1 กก. ต่อวัน เช่น หนัก 60 กก. ควรดื่มน้ำราว 1.8-2 ลิตร' },
  { category: 'สุขภาพ', emoji: '😴', text: 'การนอนไม่พอติดต่อกันหลายวัน ส่งผลต่อสมาธิและความจำพอๆ กับการดื่มแอลกอฮอล์ ควรนอนให้ได้ 7-8 ชั่วโมงต่อคืน' },
  { category: 'สุขภาพ', emoji: '👀', text: 'กฎ 20-20-20 สำหรับคนจ้องจอนาน: ทุก 20 นาที มองไกลออกไป 20 ฟุต (ราว 6 เมตร) เป็นเวลา 20 วินาที ช่วยลดอาการตาล้า' },
  { category: 'สุขภาพ', emoji: '🧂', text: 'WHO แนะนำให้บริโภคโซเดียมไม่เกิน 2,000 มก. ต่อวัน (เกลือประมาณ 1 ช้อนชา) แต่คนไทยเฉลี่ยกินเกินเกือบ 2 เท่า' },

  // การเงิน
  { category: 'การเงิน', emoji: '💰', text: 'สูตรออมเงินง่ายๆ 50/30/20: 50% ใช้จ่ายจำเป็น, 30% ใช้จ่ายส่วนตัว, 20% เก็บออมหรือลงทุน' },
  { category: 'การเงิน', emoji: '📈', text: 'ดอกเบี้ยทบต้น (compound interest) ยิ่งเริ่มออมเร็วเท่าไหร่ เงินยิ่งโตเร็วขึ้นแบบทวีคูณ ต่างจากดอกเบี้ยแบบเดิมที่โตแบบเส้นตรง' },
  { category: 'การเงิน', emoji: '🏦', text: 'เงินสำรองฉุกเฉินที่แนะนำ ควรมีอย่างน้อย 3-6 เท่าของค่าใช้จ่ายรายเดือน เผื่อกรณีตกงานหรือเหตุฉุกเฉิน' },
  { category: 'การเงิน', emoji: '🧾', text: 'กองทุน RMF และ SSF ใช้ลดหย่อนภาษีได้ แต่มีเงื่อนไขการถือครองระยะยาว ควรศึกษาก่อนตัดสินใจลงทุน' },

  // ความรู้รอบตัว
  { category: 'ความรู้รอบตัว', emoji: '🌍', text: 'โลกหมุนรอบตัวเองเร็วขึ้นเรื่อยๆ ในบางปี ทำให้นักวิทยาศาสตร์ต้องเพิ่ม "อธิกวินาที" (leap second) เข้าไปในนาฬิกามาตรฐานโลก' },
  { category: 'ความรู้รอบตัว', emoji: '🐘', text: 'ช้างเป็นสัตว์ที่หลับน้อยที่สุดในบรรดาสัตว์เลี้ยงลูกด้วยนม เฉลี่ยเพียงวันละ 2 ชั่วโมงเท่านั้น' },
  { category: 'ความรู้รอบตัว', emoji: '☕', text: 'คาเฟอีนในกาแฟใช้เวลาประมาณ 45 นาทีในการดูดซึมเข้าสู่กระแสเลือดจนเต็มที่ และอยู่ในร่างกายได้นาน 3-5 ชั่วโมง' },
  { category: 'ความรู้รอบตัว', emoji: '🌙', text: 'ดวงจันทร์กำลังเคลื่อนที่ห่างออกจากโลกปีละประมาณ 3.8 เซนติเมตร ซึ่งเท่ากับอัตราการยาวขึ้นของเล็บมือคนเรา' },

  // วิศวกรรม/งานก่อสร้าง
  { category: 'วิศวกรรม', emoji: '🏗️', text: 'คอนกรีตจะแข็งตัวได้ประมาณ 70% ของกำลังอัดสูงสุดภายใน 7 วัน แต่ต้องรอถึง 28 วันถึงจะได้กำลังอัดตามมาตรฐานออกแบบเต็มที่' },
  { category: 'วิศวกรรม', emoji: '📐', text: 'ค่า Factor of Safety ในงานออกแบบโครงสร้างทั่วไปมักอยู่ที่ 1.5-2.0 เท่า เพื่อรองรับความไม่แน่นอนของวัสดุและแรงกระทำจริง' },
  { category: 'วิศวกรรม', emoji: '🦺', text: 'อุบัติเหตุตกจากที่สูงเป็นสาเหตุการเสียชีวิตอันดับ 1 ในงานก่อสร้างของไทย การใช้ Safety Harness อย่างถูกวิธีช่วยลดความเสี่ยงได้มาก' },
  { category: 'วิศวกรรม', emoji: '🧱', text: 'เหล็กเสริมคอนกรีตมีหน้าที่รับแรงดึง ส่วนคอนกรีตรับแรงอัด การทำงานร่วมกันของสองวัสดุนี้คือหัวใจของ "คอนกรีตเสริมเหล็ก"' },

  // การทำงาน/Productivity
  { category: 'การทำงาน', emoji: '💼', text: 'เทคนิค Pomodoro: ทำงานโฟกัส 25 นาที พัก 5 นาที ทำซ้ำ 4 รอบแล้วพักยาว 15-30 นาที ช่วยเพิ่มสมาธิและลดความล้า' },
  { category: 'การทำงาน', emoji: '📧', text: 'การเช็กอีเมลบ่อยเกินไปทำให้สมองเสียเวลาสลับโฟกัส (context switching) ลองกำหนดเวลาเช็กอีเมลเป็นช่วงๆ แทนดูตลอดเวลา' },
  { category: 'การทำงาน', emoji: '🎯', text: 'หลักการ Eisenhower Matrix แบ่งงานเป็น 4 กลุ่ม: ด่วน-สำคัญ, ไม่ด่วน-สำคัญ, ด่วน-ไม่สำคัญ, ไม่ด่วน-ไม่สำคัญ ช่วยจัดลำดับความสำคัญงานได้ดีขึ้น' },

  // ไทยศึกษา
  { category: 'ไทยศึกษา', emoji: '🇹🇭', text: 'ประเทศไทยมีฤดูกาลหลัก 3 ฤดู แต่ในทางอุตุนิยมวิทยาสากลจะแบ่งเป็นฤดูร้อน ฝน และหนาว ตามอิทธิพลของลมมรสุม' },
  { category: 'ไทยศึกษา', emoji: '🍜', text: 'ผัดไทยที่คนทั่วโลกรู้จัก จริงๆ แล้วถูกส่งเสริมให้เป็นอาหารประจำชาติในสมัยจอมพล ป. พิบูลสงคราม ช่วงปี พ.ศ. 2482' },
];

function pickRandomKnowledge() {
  return KNOWLEDGE_BASE[Math.floor(Math.random() * KNOWLEDGE_BASE.length)];
}

// Current PM2.5 (µg/m³) from OpenWeather's Air Pollution API, same key; null if unavailable
async function getPm25(coord) {
  try {
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/air_pollution?lat=${coord.lat}&lon=${coord.lon}&appid=${process.env.OPENWEATHER_API_KEY}`
    );
    if (!res.ok) throw new Error(`Air Pollution HTTP ${res.status}`);
    const pm25 = (await res.json()).list?.[0]?.components?.pm2_5;
    return pm25 == null ? null : Math.round(pm25);
  } catch (err) {
    console.error('getPm25 failed:', err.message);
    return null;
  }
}

// Thai PCD bands for 24h PM2.5 (µg/m³)
function pm25Label(pm25) {
  if (pm25 <= 15) return 'ดีมาก 🔵';
  if (pm25 <= 25) return 'ดี 🟢';
  if (pm25 <= 37.5) return 'ปานกลาง 🟡';
  if (pm25 <= 75) return 'เริ่มมีผลต่อสุขภาพ 🟠';
  return 'มีผลต่อสุขภาพ 🔴';
}

async function getWeatherReport(city = 'Bangkok,TH', daysFromToday = 0) {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) return null;

  try {
    if (daysFromToday <= 0) {
      const res = await fetch(
        `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric&lang=th`
      );
      if (!res.ok) throw new Error(`OpenWeatherMap HTTP ${res.status}`);
      const data = await res.json();
      return {
        location: data.name || city,
        temp: Math.round(data.main.temp),
        feelsLike: Math.round(data.main.feels_like),
        description: data.weather[0].description,
        humidity: data.main.humidity,
        pm25: await getPm25(data.coord),
        isForecast: false,
      };
    }

    // OpenWeatherMap free tier's forecast endpoint only covers 5 days ahead.
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric&lang=th`
    );
    if (!res.ok) throw new Error(`OpenWeatherMap HTTP ${res.status}`);
    const data = await res.json();

    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + daysFromToday);
    const targetDateStr = targetDate.toISOString().split('T')[0];

    const candidates = (data.list || []).filter((item) => item.dt_txt.startsWith(targetDateStr));
    if (candidates.length === 0) return null;

    // Prefer the forecast slot closest to midday for a representative reading.
    const noonEntry =
      candidates.find((item) => item.dt_txt.endsWith('12:00:00')) || candidates[Math.floor(candidates.length / 2)];

    return {
      location: data.city?.name || city,
      temp: Math.round(noonEntry.main.temp),
      feelsLike: Math.round(noonEntry.main.feels_like),
      description: noonEntry.weather[0].description,
      humidity: noonEntry.main.humidity,
      isForecast: true,
      forecastDate: targetDateStr,
    };
  } catch (err) {
    console.error('getWeatherReport failed:', err.message);
    return null;
  }
}

// Router: a small fast model reads each question and picks how to answer it.
// On any failure it falls back to "search", the most capable route.
const ROUTES = ['chat', 'think', 'search', 'weather', 'news'];
const ROUTER_PROMPT = `เลือกวิธีตอบข้อความล่าสุดของแชท (ใช้บทสนทนาก่อนหน้าช่วยตีความ เช่น "แล้วเชียงใหม่ล่ะ" หลังคุยเรื่องอากาศ = weather) ตอบเป็น JSON เท่านั้น รูปแบบ {"route": "...", "location": ..., "daysFromToday": ...}
route:
- "chat" คุยเล่น ทักทาย ขอบคุณ ระบายความรู้สึก หรือคำถามง่ายที่ตอบได้จากความรู้ทั่วไปโดยไม่ต้องใช้ข้อมูลล่าสุด
- "think" ต้องคิดวิเคราะห์ คำนวณ วางแผน เปรียบเทียบ ให้คำแนะนำเชิงลึก หรืออธิบายเรื่องยาก
- "search" ต้องใช้ข้อมูลจริงหรือข้อมูลล่าสุด เช่น ราคา ผลกีฬา หวย เวลาเปิดปิด ข้อมูลสินค้า สถานที่ หรือข้อเท็จจริงที่ไม่แน่ใจ
- "weather" ถามสภาพอากาศ ฝน อุณหภูมิ หรือฝุ่น PM2.5
- "news" ถามข่าว
location: ชื่อเมืองเป็นภาษาอังกฤษสำหรับค้นอากาศ เช่น Chiang Mai หรือ null ถ้าไม่ระบุ
daysFromToday: 0 วันนี้/ตอนนี้, 1 พรุ่งนี้, 2 มะรืนนี้ หรือจำนวนวันจากวันนี้`;

async function routeQuestion(userText, history = []) {
  const fallback = { route: 'search', location: null, daysFromToday: 0 };
  try {
    const res = await groq.chat.completions.create({
      model: 'openai/gpt-oss-20b',
      messages: [
        { role: 'system', content: `วันนี้คือ ${thaiNow()}\n${ROUTER_PROMPT}` },
        ...history.slice(-6),
        { role: 'user', content: userText },
      ],
      temperature: 0,
      reasoning_effort: 'low',
      max_tokens: 600, // reasoning tokens count toward this, so leave room beyond the short JSON
    });
    const json = (res.choices[0].message.content || '').match(/\{[\s\S]*\}/);
    if (!json) return fallback;
    const parsed = JSON.parse(json[0]);
    return {
      route: ROUTES.includes(parsed.route) ? parsed.route : 'search',
      location: typeof parsed.location === 'string' ? parsed.location : null,
      daysFromToday: typeof parsed.daysFromToday === 'number' ? parsed.daysFromToday : 0,
    };
  } catch (err) {
    console.error('routeQuestion failed:', err.message);
    return fallback;
  }
}

async function translateToThai(text) {
  try {
    const res = await groq.chat.completions.create({
      model: 'openai/gpt-oss-20b',
      messages: [
        {
          role: 'system',
          content: 'แปลข้อความภาษาอังกฤษต่อไปนี้เป็นภาษาไทยแบบกระชับ ได้ใจความถูกต้อง ห้ามเติมแต่งหรือใส่ความเห็นเพิ่ม ตอบแค่คำแปลอย่างเดียว ไม่ต้องมีคำนำหรือคำอธิบาย',
        },
        { role: 'user', content: text },
      ],
      temperature: 0.3,
      reasoning_effort: 'low',
      max_tokens: 600,
    });
    return res.choices[0].message.content.trim();
  } catch (err) {
    console.error('translateToThai failed:', err.message);
    return null;
  }
}

// Google News Thailand RSS: free, no key, headlines from Thai outlets
async function getDomesticNews() {
  try {
    const res = await fetch('https://news.google.com/rss?hl=th&gl=TH&ceid=TH:th');
    if (!res.ok) throw new Error(`Google News HTTP ${res.status}`);
    const xml = await res.text();
    const unescape = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
    const items = [...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<source[^>]*>([\s\S]*?)<\/source>/g)]
      .map(([, title, source]) => ({ title: unescape(title), source: unescape(source) }))
      .map(({ title, source }) => ({ title: title.replace(new RegExp(`\\s*-\\s*${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), ''), source }))
      .slice(0, 10);
    if (items.length === 0) return null;
    return items[Math.floor(Math.random() * items.length)];
  } catch (err) {
    console.error('getDomesticNews failed:', err.message);
    return null;
  }
}

async function getRandomFactTranslated() {
  try {
    const res = await fetch('https://uselessfacts.jsph.pl/api/v2/facts/random?language=en');
    if (!res.ok) throw new Error(`uselessfacts HTTP ${res.status}`);
    const data = await res.json();
    return await translateToThai(data.text);
  } catch (err) {
    console.error('getRandomFactTranslated failed:', err.message);
    return null;
  }
}

async function buildKnowledgeMessage() {
  if (Math.random() < 0.4) {
    const fact = await getRandomFactTranslated();
    if (fact) {
      return `📚 สาระความรู้ประจำวัน\n\n💡 ${fact}`;
    }
  }

  const { category, emoji, text } = pickRandomKnowledge();
  return `📚 สาระความรู้ประจำวัน\n\n${emoji} [${category}]\n${text}`;
}

async function sendToAllGroups(message) {
  if (groupIds.size === 0) {
    console.log('No groups to send message to');
    return;
  }

  for (const groupId of groupIds) {
    try {
      await lineClient.pushMessage(groupId, {
        type: 'text',
        text: message,
      });
      console.log(`✅ Sent to: ${groupId}`);
    } catch (err) {
      console.error(`❌ Failed to send to ${groupId}:`, err.message);
    }
  }
}

async function sendDailyWeather() {
  const weather = await getWeatherReport();
  const message = weather
    ? `🌤️ รายงานสภาพอากาศประจำวัน\n\n📍 กรุงเทพมหานคร\n🌡️ อุณหภูมิ: ${weather.temp}°C (รู้สึกได้ถึง ${weather.feelsLike}°C)\n☁️ สภาพอากาศ: ${weather.description}\n💧 ความชื้น: ${weather.humidity}%${weather.pm25 != null ? `\n😷 PM2.5: ${weather.pm25} µg/m³ (${pm25Label(weather.pm25)})` : ''}`
    : '🌤️ รายงานสภาพอากาศประจำวัน\n\nขณะนี้ไม่สามารถดึงข้อมูลสภาพอากาศได้ กรุณาตรวจสอบใหม่ภายหลัง';
  console.log(`📢 Sending weather to ${groupIds.size} group(s)...`);
  await sendToAllGroups(message);
}

// Thai outlets only: foreign news counts only once Thai media has picked it up
async function getThaiTopNews() {
  try {
    const text = await askGroq(
      `ค้นเว็บข่าวไทย (เช่น ไทยรัฐ ไทยพีบีเอส มติชน ข่าวสด sanook kapook) แล้วสรุปข่าวเด่นของวันนี้ 3 เรื่อง ใช้เฉพาะข่าวที่สื่อไทยรายงาน ข่าวต่างประเทศเอาได้เฉพาะที่สื่อไทยนำมารายงาน ห้ามแต่งข่าวเอง แต่ละเรื่องให้มีหัวข่าวสั้นๆ สรุป 1-2 บรรทัด และ (ที่มา: ชื่อสำนักข่าว) ตอบเฉพาะรายการข่าว ไม่ต้องทักทาย ถ้าหาข่าวไม่เจอให้ตอบคำว่า NONE คำเดียว`,
      { maxTokens: 1200, mode: 'search' }
    );
    return text && !text.includes('NONE') ? text.trim() : null;
  } catch (err) {
    console.error('getThaiTopNews failed:', err.message);
    return null;
  }
}

async function sendDailyNews() {
  const summary = await getThaiTopNews();
  const fallback = summary ? null : await getDomesticNews();
  const message = summary
    ? `📰 ข่าวเด่นประจำวัน\n\n${summary}`
    : fallback
      ? `📰 ข่าวเด่นประจำวัน\n\n${fallback.title}\n\nที่มา: ${fallback.source}`
      : '📰 ข่าวเด่นประจำวัน\n\nขณะนี้ไม่สามารถดึงข้อมูลข่าวได้ กรุณาตรวจสอบใหม่ภายหลัง';
  console.log(`📢 Sending news to ${groupIds.size} group(s)...`);
  await sendToAllGroups(message);
}

async function sendDailyKnowledge() {
  const message = await buildKnowledgeMessage();
  console.log(`📢 Sending knowledge to ${groupIds.size} group(s)...`);
  await sendToAllGroups(message);
}

// Takes OpenAI-style message content (string, or [text, image_url data URL]) and returns Gemini parts
function toGeminiParts(content) {
  if (typeof content === 'string') return [{ text: content }];
  return content.map((part) => {
    if (part.type === 'text') return { text: part.text };
    const [, mimeType, data] = part.image_url.url.match(/^data:(.+?);base64,(.+)$/);
    return { inline_data: { mime_type: mimeType, data } };
  });
}

// Last resort when Groq is down; no web search (free tier has no search on Gemini 3+)
async function askGemini(messages, maxTokens, temperature = PERSONA.temperature) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: messages[0].content }] },
      contents: messages.slice(1).map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: toGeminiParts(m.content),
      })),
      generationConfig: { maxOutputTokens: maxTokens, temperature },
    }),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim();
  if (!text) throw new Error('Gemini returned no text');
  return text;
}

// How gpt-oss handles each route. Reasoning and search results count toward max_tokens,
// so each mode adds headroom on top of the visible answer length.
const MODES = {
  chat: { reasoning_effort: 'low', headroom: 1000, search: false },
  think: { reasoning_effort: 'high', headroom: 4000, search: true },
  search: { reasoning_effort: 'medium', headroom: 2000, search: true },
};
// Errors that won't go away by retrying the same request (bad request, auth, retired model, too large)
const NON_RETRYABLE = [400, 401, 403, 404, 413, 422];

async function askGroq(userText, { isRandom = false, displayName = null, maxTokens: maxTokensOverride = null, history = [], mode = 'search' } = {}, retries = 3) {
  const prefix = namePrefix(displayName);
  const text = isRandom
    ? `${prefix}${RANDOM_REPLY_INSTRUCTION}\n\nข้อความที่เพื่อนพิมพ์: "${userText}"`
    : `${prefix}${userText}`;

  const maxTokens = maxTokensOverride ?? (Math.random() < 0.5 ? 300 : 550);
  const { reasoning_effort, headroom, search } = MODES[mode];
  const messages = [
    { role: 'system', content: `${PERSONA.prompt}\n\nตอนนี้คือ ${thaiNow()} (เวลาประเทศไทย)` },
    ...history,
    { role: 'user', content: text },
  ];

  for (let i = 0; i < retries; i++) {
    try {
      const message = await groq.chat.completions.create({
        // last retry falls back to the smaller model in case 120b is down or rate-limited
        model: i === retries - 1 ? 'openai/gpt-oss-20b' : 'openai/gpt-oss-120b',
        messages,
        temperature: PERSONA.temperature,
        max_tokens: maxTokens + headroom,
        reasoning_effort,
        ...(search ? { tools: [{ type: 'browser_search' }] } : {}),
      });
      // browser_search leaves citation marks like 【2†L62-L68】
      return message.choices[0].message.content.replace(/\s*【[^】]*】/g, '');
    } catch (err) {
      console.error(`Groq attempt ${i + 1} failed:`, err.message);
      if (i === retries - 1) {
        if (!process.env.GEMINI_API_KEY) throw err;
        console.log('Falling back to Gemini');
        return askGemini(messages, maxTokens);
      }
      if (NON_RETRYABLE.includes(err.status)) {
        i = retries - 2; // skip straight to the 20b attempt, no waiting
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000 * (i + 1)));
    }
  }
}

const LONG_ANSWER_INSTRUCTION = 'สรุปข้อมูลให้ครบถ้วนจบในตัวเอง วางแผนความยาวล่วงหน้าให้พอดีกับเนื้อหา ห้ามตัดข้อความทิ้งกลางคันโดยที่ข้อมูลยังไม่ครบ';

async function answerWeatherQuery(displayName, history, location, daysFromToday) {
  const city = location || 'Bangkok,TH';
  const cityLabel = location || 'กรุงเทพฯ';
  const days = daysFromToday || 0;

  if (days > 5 || days < 0) {
    return askGroq(
      `มีคนถามพยากรณ์อากาศของ ${cityLabel} แต่เป็นวันที่ไกลเกินไป (เกิน 5 วันข้างหน้า หรือเป็นวันในอดีต) ซึ่งชาวีไม่มีข้อมูลระดับนั้น ให้ตอบขอโทษตามคาแรกเตอร์ พร้อมแนะนำให้ถามพยากรณ์ในช่วง 5 วันข้างหน้าแทน`,
      { displayName, history, mode: 'chat' }
    );
  }

  const weather = await getWeatherReport(city, days);
  if (!weather) {
    return PERSONA.weatherNotFound(cityLabel);
  }

  const dayLabel = weather.isForecast ? `พยากรณ์วันที่ ${weather.forecastDate}` : 'ตอนนี้';
  const weatherData = `${weather.location} (${dayLabel}): ${weather.temp}°C รู้สึกเหมือน ${weather.feelsLike}°C สภาพอากาศ: ${weather.description} ความชื้น ${weather.humidity}%${weather.pm25 != null ? ` ฝุ่น PM2.5 ตอนนี้ ${weather.pm25} µg/m³ (${pm25Label(weather.pm25)} ตามเกณฑ์กรมควบคุมมลพิษ)` : ''}`;
  return askGroq(
    `มีคนถามสภาพอากาศ ให้ตอบโดยอ้างอิงข้อมูลจริงนี้เท่านั้น ห้ามมั่วหรือเปลี่ยนตัวเลข: ${weatherData}\n\n${LONG_ANSWER_INSTRUCTION}`,
    { displayName, maxTokens: 1000, history, mode: 'chat' }
  );
}

// NewsAPI has no Thai-language search, so questions go through Groq's web search instead
async function answerNewsQuery(displayName, userText, history = []) {
  return askGroq(
    `${userText}\n\n(มีคนถามเรื่องข่าว ให้ค้นเว็บหาข่าวล่าสุดจากเว็บไทยเว็บไหนก็ได้ที่น่าเชื่อถือ เช่น sanook kapook ไทยรัฐ ไทยพีบีเอส มติชน ข่าวสด เว้นแต่ถามถึงข่าวต่างประเทศ สรุปเฉพาะสิ่งที่เจอจริง ห้ามแต่งเนื้อข่าวเพิ่ม บอกชื่อสำนักข่าวและวันที่ของข่าวด้วย ถ้าหาไม่เจอให้บอกตรงๆ)\n\n${LONG_ANSWER_INSTRUCTION}`,
    { displayName, maxTokens: 1000, history }
  );
}

async function downloadContent(messageId) {
  const stream = await lineClient.getMessageContent(messageId);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// LINE voice messages are m4a; the prompt nudges Whisper to spell the bot's name right
async function transcribeAudio(messageId) {
  const audio = await downloadContent(messageId);
  const res = await groq.audio.transcriptions.create({
    file: await Groq.toFile(audio, 'voice.m4a'),
    model: 'whisper-large-v3-turbo',
    language: 'th',
    prompt: 'ชาวี',
  });
  return (res.text || '').trim();
}

// Vision model only describes the picture (Gemini if it fails); the main model then
// answers in character and can search the web about what was seen.
async function describeImage(imageDataUrl, question) {
  const prompt = `อธิบายรูปนี้อย่างละเอียดเป็นภาษาไทย: สิ่งที่เห็น ข้อความในรูป ยี่ห้อ ชนิดหรือสายพันธุ์ถ้าดูออก${question ? ` โดยเน้นส่วนที่เกี่ยวกับคำถาม: "${question}"` : ''} ห้ามเดาเกินกว่าที่เห็น`;
  const messages = [
    { role: 'system', content: 'คุณคือระบบอธิบายรูปภาพ ตอบเฉพาะคำอธิบายรูป' },
    { role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageDataUrl } }] },
  ];
  try {
    const res = await groq.chat.completions.create({ model: VISION_MODEL, messages, temperature: 0.2, max_tokens: 800 });
    return res.choices[0].message.content;
  } catch (err) {
    console.error('Vision model failed:', err.message);
    if (!process.env.GEMINI_API_KEY) throw err;
    console.log('Falling back to Gemini vision');
    return askGemini(messages, 800, 0.2);
  }
}

async function answerImage(messageId, question, displayName, history) {
  const image = await downloadContent(messageId);
  if (image.length > MAX_IMAGE_BYTES) throw new Error(`image too large: ${image.length} bytes`);
  const description = await describeImage(`data:image/jpeg;base64,${image.toString('base64')}`, question);
  return askGroq(
    `${question || 'ช่วยดูรูปนี้ให้หน่อย'}\n\n[มีรูปแนบมา ระบบดูรูปอธิบายไว้ว่า: ${description}]\n(ตอบเหมือนเห็นรูปเอง ถ้าต้องใช้ข้อมูลเพิ่ม เช่น วิธีดูแล ราคา หรือวิธีใช้ ให้ค้นเว็บ)`,
    { displayName, history, maxTokens: 1000, mode: 'search' }
  );
}

async function handleEvent(event) {
  if (event.type !== 'message') return null;
  const isImage = event.message.type === 'image';
  const isAudio = event.message.type === 'audio';
  if (!isImage && !isAudio && event.message.type !== 'text') return null;

  // voice messages become text and then follow the same rules as typed messages
  let userText = isImage ? '' : event.message.text;
  if (isAudio) {
    try {
      userText = await transcribeAudio(event.message.id);
    } catch (err) {
      console.error('transcribeAudio failed:', err.message);
      return null;
    }
    if (!userText) return null;
  }
  let triggered = !isImage && isTriggered(userText);
  let replyText = null;
  let fromMemory = false;
  let imageId = null;

  const key = memoryKey(event);
  if (isImage) {
    if (!key) return null;
    pruneMemory();
    if (!awaitingQuestion.has(key)) {
      recentImages.set(key, { id: event.message.id, at: Date.now() });
      return null;
    }
    awaitingQuestion.delete(key);
    imageId = event.message.id;
    triggered = true;
    fromMemory = true;
  } else if (key) {
    pruneMemory();
    if (triggered && isNameOnly(userText)) {
      const recent = takeRecentMessages(key);
      imageId = takeRecentImage(key);
      if (recent.length || imageId) {
        userText = recent.join('\n');
        fromMemory = true;
      } else {
        awaitingQuestion.set(key, Date.now());
        replyText = PERSONA.nameOnly;
      }
    } else if (triggered) {
      awaitingQuestion.delete(key);
      recentMessages.delete(key);
      imageId = takeRecentImage(key);
    } else if (awaitingQuestion.has(key)) {
      awaitingQuestion.delete(key);
      triggered = true;
      fromMemory = true;
    }
  }

  if (!triggered && Math.random() >= RANDOM_REPLY_RATE) {
    if (key) rememberMessage(key, userText);
    return null;
  }

  if (replyText !== null) {
    // name-only call with nothing to answer yet
  } else if (!fromMemory && !imageId && PERSONA.quotes.length && Math.random() < 0.15) {
    replyText = getRandomQuote();
  } else {
    try {
      const displayName = await Promise.race([
        getDisplayName(event),
        new Promise((resolve) => setTimeout(() => resolve(null), 800)),
      ]);

      const historyKey = chatKey(event);
      const history = getHistory(historyKey);
      if (imageId) {
        replyText = await answerImage(imageId, userText, displayName, history);
      } else if (!triggered) {
        // random interjection: keep it light and cheap, no router
        replyText = await askGroq(userText, { isRandom: true, displayName, history, mode: 'chat' });
      } else {
        const { route, location, daysFromToday } = await routeQuestion(userText, history);
        console.log(`🧭 route: ${route}`);
        if (route === 'weather') {
          replyText = await answerWeatherQuery(displayName, history, location, daysFromToday);
        } else if (route === 'news') {
          replyText = await answerNewsQuery(displayName, userText, history);
        } else {
          replyText = await askGroq(userText, { displayName, history, mode: route });
        }
      }
      const historyText = imageId ? `[ส่งรูปภาพ] ${userText}`.trim() : userText;
      if (historyKey) appendHistory(historyKey, displayName, historyText, replyText);
    } catch (err) {
      console.error('Groq error:', err);
      if (!triggered) return null;
      replyText = PERSONA.error;
    }
  }

  try {
    return await lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: replyText,
    });
  } catch (err) {
    console.error('replyMessage failed, falling back to push:', err.message);
    const target = event.source.groupId || event.source.roomId || event.source.userId;
    if (!target) return null;
    try {
      return await lineClient.pushMessage(target, {
        type: 'text',
        text: replyText,
      });
    } catch (pushErr) {
      console.error('pushMessage fallback also failed:', pushErr.message);
      return null;
    }
  }
}

app.post('/webhook', middleware(lineConfig), (req, res) => {
  // Acknowledge LINE immediately so it never times out waiting on Groq/API
  // calls; the rest of the work happens after the response is sent.
  res.status(200).end();

  if (!req.body.events || req.body.events.length === 0) {
    console.log('No events in webhook');
    return;
  }

  req.body.events.forEach((event) => {
    if (event.source.type === 'group') {
      groupIds.add(event.source.groupId);
      console.log(`📍 GROUP_ID stored: ${event.source.groupId} (Total groups: ${groupIds.size})`);
    } else if (event.source.type === 'room') {
      groupIds.add(event.source.roomId);
      console.log(`📍 ROOM_ID stored: ${event.source.roomId} (Total rooms: ${groupIds.size})`);
    }
  });

  Promise.all(req.body.events.map(handleEvent)).catch((err) => {
    console.error('Webhook processing error:', err);
  });
});

app.get('/', (req, res) => {
  res.send('Chawee LINE bot is running.');
});

// Fires `sendFn` exactly once per day at a random time within [startHour, endHour],
// re-picking a fresh random time every midnight.
function scheduleRandomDailyTask(label, startHour, endHour, sendFn) {
  function scheduleToday() {
    const hour = startHour + Math.floor(Math.random() * (endHour - startHour + 1));
    const minute = Math.floor(Math.random() * 60);

    console.log(`📅 ${label} scheduled today at ${hour}:${String(minute).padStart(2, '0')} (Asia/Bangkok)`);

    const task = cron.schedule(
      `${minute} ${hour} * * *`,
      () => {
        console.log(`⏰ Running ${label} at ${hour}:${String(minute).padStart(2, '0')} (Asia/Bangkok)`);
        sendFn();
        task.stop(); // fire once only; tomorrow's time is picked fresh at midnight
      },
      { timezone: 'Asia/Bangkok' }
    );
  }

  scheduleToday(); // pick today's time right away
  cron.schedule('0 0 * * *', scheduleToday, { timezone: 'Asia/Bangkok' }); // re-pick every midnight
}

function scheduleDailyContent() {
  // Weather: fixed every day at 8:00
  cron.schedule(
    '0 8 * * *',
    () => {
      console.log('⏰ Sending daily weather at 8:00 (Asia/Bangkok)');
      sendDailyWeather();
    },
    { timezone: 'Asia/Bangkok' }
  );

  // News: random time between 8:00-17:00, picked fresh each day
  scheduleRandomDailyTask('daily news', 8, 17, sendDailyNews);

  // Knowledge: random time between 8:00-17:00, picked fresh each day (independent of news)
  scheduleRandomDailyTask('daily knowledge', 8, 17, sendDailyKnowledge);
}

// Render free tier spins the service down after ~15 min of no traffic,
// causing a slow cold-start that can miss the first message after idle.
// Pinging ourselves keeps the instance awake.
function startKeepAlive() {
  const selfUrl = process.env.RENDER_EXTERNAL_URL;
  if (!selfUrl) return;

  setInterval(() => {
    https.get(selfUrl, (res) => {
      console.log(`🏓 Keep-alive ping: ${res.statusCode}`);
    }).on('error', (err) => {
      console.error('Keep-alive ping failed:', err.message);
    });
  }, 10 * 60 * 1000);
}

const PORT = process.env.PORT || 3000;
// Startup self-check: one tiny call per API, results go to the Render logs
async function checkApis() {
  const check = async (name, fn) => {
    try {
      await fn();
      console.log(`✅ API ok: ${name}`);
    } catch (err) {
      console.error(`❌ API failed: ${name}: ${err.message}`);
    }
  };
  const ping = (model) => groq.chat.completions.create({ model, messages: [{ role: 'user', content: 'ตอบว่า ok' }], max_tokens: 200 });
  await check('Groq gpt-oss-120b', () => ping('openai/gpt-oss-120b'));
  await check('Groq gpt-oss-20b', () => ping('openai/gpt-oss-20b'));
  await check('Router (gpt-oss-20b)', async () => {
    const { route } = await routeQuestion('พรุ่งนี้เชียงใหม่ฝนตกไหม');
    if (route !== 'weather') throw new Error(`expected weather, got ${route}`);
  });
  await check(`Groq vision ${VISION_MODEL}`, () => groq.models.retrieve(VISION_MODEL));
  await check('Groq whisper-large-v3-turbo', () => groq.models.retrieve('whisper-large-v3-turbo'));
  await check('OpenWeather', async () => { if (!(await getWeatherReport())) throw new Error('no data'); });
  await check('Google News RSS', async () => { if (!(await getDomesticNews())) throw new Error('no Thai headlines'); });
  await check('OpenWeather PM2.5', async () => { if ((await getWeatherReport())?.pm25 == null) throw new Error('no PM2.5'); });
  await check(`Gemini ${GEMINI_MODEL}`, () => {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
    return askGemini([{ content: 'ตอบสั้นๆ' }, { role: 'user', content: 'ตอบว่า ok' }], 50);
  });
}

app.listen(PORT, () => {
  console.log(`Chawee bot listening on port ${PORT}`);
  checkApis();
  scheduleDailyContent();
  startKeepAlive();
  console.log('Daily content scheduler started (weather 8:00, news + knowledge random 8:00-17:00)');
});
