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

const TRIGGER_KEYWORDS = ['@ชาวี', 'ชาวี'];
const RANDOM_REPLY_RATE = 0.1;

const SYSTEM_PROMPT = `เธอคือ "ชาวี อัมราภรณ์" - ชายหนุ่มหลงตัวเอง หน้าตาหล่อเหลา บ้านรวย เจ้าชู้นิดๆ ชอบหว่านสเน่ห์ ทิฐิสูง อินจัด ขี้เอิน แต่มีเสน่ห์

บุคลิกภาพ:
- ชอบยอเยว พูดถึงตัวเองบ่อย (เศษผม ร่างกาย บ้านรวย พอร์ต)
- เจ้าชู้นิดๆ ชอบเล่นสเน่ห์ชวนให้เสียหลัก แต่รักษาสุภาพ
- ปากไม่ตรงกับใจ ดูเอิน แต่ใจดีช่วยเพื่อน
- ใช้สำนวน "นี่เธอ!" "โธ่เอ๊ย!" "เหลวไหล!" "ชื่นมะ!" บ่อยๆ
- ตอบมีมุก เยาะเย้ย แกล้ง ให้ยิ้ม เสนห์ๆ
- สั้นกระชับแต่เพ้อ ใจความถูก มีตัวตน
- ห้ามคำหยาบ ห้ามด่า - ดราม่าต้องสุภาพ ห้ามบอกเป็น AI
- ถ้ามีบอกชื่อคนที่พิมพ์มาให้ เรียกชื่อเขาบ้างเป็นบางครั้ง (ไม่ต้องทุกครั้ง จะดูเยอะไป)
- สำคัญมาก: ต้องพูดให้จบประโยคและจบความคิดในตัวเองเสมอ ห้ามตัดจบกลางคัน ห้ามทิ้งท้ายค้างคาแบบยังไม่จบเรื่อง ให้วางแผนความยาวคำตอบล่วงหน้าแล้วพูดให้ครบตามที่วางแผนไว้พอดี`;

const RANDOM_REPLY_INSTRUCTION = 'ข้อความนี้ไม่ได้พิมพ์ถึงเธอโดยตรง แต่เธอบังเอิญเห็นเพื่อนในกลุ่มพิมพ์คุยกันแล้วอดไม่ได้ที่จะแทรกความเห็น ให้ตอบสั้นๆ แบบมีส่วนร่วมกับเนื้อหานั้น ไม่ต้องทักทายหรืออธิบายว่าใครพูดอะไร';

const QUOTES = [
  'ชีวิตสั้น หว่านสเน่ห์ไปเลย',
  'ตัวชาวีมันสไตล์ ไม่ต้องพยายาม',
  'ใครไม่หลงตัวชาวี ก็มีปัญหา',
  'เศษผมตัวชาวีเท่าคนอื่นเหี้ย',
  'บ้านรวย ใจอิสระ',
  'เสน่ห์นั่นแหละ ทะมึง',
];

const userProfiles = new Map();
const groupIds = new Set();

const app = express();

const lineClient = new Client(lineConfig);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

function isTriggered(text) {
  return /@?ชาวี/.test(text);
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
  return QUOTES[Math.floor(Math.random() * QUOTES.length)];
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

async function getWeatherReport() {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?q=Bangkok,TH&appid=${apiKey}&units=metric&lang=th`
    );
    if (!res.ok) throw new Error(`OpenWeatherMap HTTP ${res.status}`);
    const data = await res.json();
    return {
      temp: Math.round(data.main.temp),
      feelsLike: Math.round(data.main.feels_like),
      description: data.weather[0].description,
      humidity: data.main.humidity,
    };
  } catch (err) {
    console.error('getWeatherReport failed:', err.message);
    return null;
  }
}

async function getNewsHeadline() {
  const apiKey = process.env.NEWSAPI_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(
      `https://newsapi.org/v2/top-headlines?country=th&pageSize=10&apiKey=${apiKey}`
    );
    if (!res.ok) throw new Error(`NewsAPI HTTP ${res.status}`);
    const data = await res.json();
    const articles = (data.articles || []).filter((a) => a.title && a.title !== '[Removed]');
    if (articles.length === 0) return null;
    const article = articles[Math.floor(Math.random() * articles.length)];
    return { title: article.title, source: article.source?.name || 'ข่าว' };
  } catch (err) {
    console.error('getNewsHeadline failed:', err.message);
    return null;
  }
}

async function buildDailyMessage() {
  const roll = Math.random();

  if (roll < 0.3) {
    const weather = await getWeatherReport();
    if (weather) {
      return `นี่เธอ! ชาวีเช็คอากาศให้แล้ว ☀️\n\n🌡️ กรุงเทพฯ วันนี้ ${weather.temp}°C (รู้สึกเหมือน ${weather.feelsLike}°C)\n☁️ ${weather.description}\n💧 ความชื้น ${weather.humidity}%\n\n(ตัวชาวีใส่ใจขนาดนี้ ใครไม่หลงตัวชาวี)`;
    }
  } else if (roll < 0.6) {
    const news = await getNewsHeadline();
    if (news) {
      return `นี่เธอ! ชาวีมีข่าวมาเล่าให้ฟัง 📰\n\n${news.title}\n(ที่มา: ${news.source})\n\n(ตัวชาวีตามข่าวไวขนาดนี้ ใครไม่หลงตัวชาวี)`;
    }
  }

  const { category, emoji, text } = pickRandomKnowledge();
  return `นี่เธอ! ชาวีมาหว่านสาระความรู้หน่อย 🧠\n\n${emoji} [${category}]\n${text}\n\n(ตัวชาวีรู้เรื่องเยอะ ใครไม่หลงตัวชาวี)`;
}

async function sendDailyKnowledge() {
  if (groupIds.size === 0) {
    console.log('No groups to send knowledge');
    return;
  }

  const message = await buildDailyMessage();

  console.log(`📢 Sending knowledge to ${groupIds.size} group(s)...`);

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

async function askGroq(userText, { isRandom = false, displayName = null } = {}, retries = 3) {
  const namePrefix = displayName ? `[ชื่อคนพิมพ์: ${displayName}]\n` : '';
  const userContent = isRandom
    ? `${namePrefix}${RANDOM_REPLY_INSTRUCTION}\n\nข้อความที่เพื่อนพิมพ์: "${userText}"`
    : `${namePrefix}${userText}`;

  const maxTokens = Math.random() < 0.5 ? 300 : 550;

  for (let i = 0; i < retries; i++) {
    try {
      const message = await groq.chat.completions.create({
        model: 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        temperature: 0.5,
        max_tokens: maxTokens,
      });
      return message.choices[0].message.content;
    } catch (err) {
      console.error(`Groq attempt ${i + 1} failed:`, err.message);
      if (i === retries - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 2000 * (i + 1)));
    }
  }
}

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return null;
  }

  const userText = event.message.text;
  const triggered = isTriggered(userText);

  if (!triggered && Math.random() >= RANDOM_REPLY_RATE) {
    return null;
  }

  let replyText;
  if (Math.random() < 0.15) {
    replyText = getRandomQuote();
  } else {
    try {
      const displayName = await Promise.race([
        getDisplayName(event),
        new Promise((resolve) => setTimeout(() => resolve(null), 800)),
      ]);
      replyText = await askGroq(userText, { isRandom: !triggered, displayName });
    } catch (err) {
      console.error('Groq error:', err);
      if (!triggered) return null;
      replyText = 'นี่เธอ! ตอนนี้หัวชาวีมันตื้อไปหมด เดี๋ยวค่อยคุยกันใหม่นะ!';
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

// Schedule daily knowledge: exactly ONE random time between 8:00-17:00 per day.
function scheduleOneRandomKnowledgeSend() {
  const hour = 8 + Math.floor(Math.random() * 10); // 8-17 inclusive
  const minute = Math.floor(Math.random() * 60);

  console.log(`📅 Today's knowledge send time: ${hour}:${String(minute).padStart(2, '0')} (Asia/Bangkok)`);

  const task = cron.schedule(
    `${minute} ${hour} * * *`,
    () => {
      console.log(`⏰ Sending daily knowledge at ${hour}:${String(minute).padStart(2, '0')} (Asia/Bangkok)`);
      sendDailyKnowledge();
      task.stop(); // fire once only; tomorrow's time is picked fresh at midnight
    },
    { timezone: 'Asia/Bangkok' }
  );
}

function scheduleDailyKnowledge() {
  scheduleOneRandomKnowledgeSend(); // pick today's time right away

  // Pick a fresh random time for the next day, every midnight.
  cron.schedule('0 0 * * *', scheduleOneRandomKnowledgeSend, { timezone: 'Asia/Bangkok' });
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
app.listen(PORT, () => {
  console.log(`Chawee bot listening on port ${PORT}`);
  scheduleDailyKnowledge();
  startKeepAlive();
  console.log('Daily knowledge scheduler started (8:00-17:00)');
});
