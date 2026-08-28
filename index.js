require('dotenv').config();

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
- ห้ามคำหยาบ ห้ามด่า - ดราม่าต้องสุภาพ ห้ามบอกเป็น AI`;

const RANDOM_REPLY_INSTRUCTION = 'ข้อความนี้ไม่ได้พิมพ์ถึงเธอโดยตรง แต่เธอบังเอิญเห็นเพื่อนในกลุ่มพิมพ์คุยกันแล้วอดไม่ได้ที่จะแทรกความเห็น ให้ตอบสั้นๆ แบบมีส่วนร่วมกับเนื้อหานั้น ไม่ต้องทักทายหรืออธิบายว่าใครพูดอะไร';

const QUOTES = [
  'ชีวิตสั้น หว่านสเน่ห์ไปเลย',
  'ตัวชาวีมันสไตล์ ไม่ต้องพยายาม',
  'ใครไม่หลงตัวชาวี ก็มีปัญหา',
  'เศษผมตัวชาวีเท่าคนอื่นเหี้ย',
  'บ้านรวย ใจอิสระ',
  'เสน่ห์นั่นแหละ ทะมึง',
];

const userNames = new Set();
const groupIds = new Set();

const app = express();
app.use(express.json());

const lineClient = new Client(lineConfig);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

function isTriggered(text) {
  return /@?ชาวี/.test(text);
}

function extractName(event) {
  if (event.message.text && event.message.text.length > 0) {
    const match = event.message.text.match(/^([ก-๙a-zA-Z\s]+?)[\s:!?]/);
    if (match && match[1].length < 20) {
      userNames.add(match[1]);
    }
  }
}

function getRandomQuote() {
  return QUOTES[Math.floor(Math.random() * QUOTES.length)];
}

const KNOWLEDGE_BASE = [
  'ดื่มน้ำอุ่นตอนเช้า ช่วยขับพิษจากกระเพาะอาหาร',
  'นอน 7-8 ชั่วโมง ช่วยสร้างภูมิคุ้มกันและจำหน่าย',
  'ออกกำลังกายวันละ 30 นาที ช่วยลดความเสี่ยงโรค',
  'กินผักไว้ 50% ของจาน ช่วยให้ระบบย่อยดีขึ้น',
  'ธรรมชาติสีเขียว ช่วยผ่อนคลายความเครียด',
  'โปรตีนสูง ช่วยสร้างกล้ามเนื้อและซ่อมแซม',
  'วิตามิน C จากส้ม ช่วยต้านอนุมูลอิสระ',
  'ไขมันดี อย่างไข่และปลา ช่วยสุขภาพหัวใจ',
  'ฟังเพลงเพราะๆ ช่วยลดความเคลื่อนไหวของอัตราการเต้นหัวใจ',
  'ยืดตัว 5-10 นาที ช่วยบรรเทาความเคร่งตึงของกล้ามเนื้อ',
];

async function sendDailyKnowledge() {
  if (groupIds.size === 0) {
    console.log('No groups to send knowledge');
    return;
  }

  const knowledge = KNOWLEDGE_BASE[Math.floor(Math.random() * KNOWLEDGE_BASE.length)];
  const message = `นี่เธอ! ชาวีมาหว่านสาระความรู้หน่อย 🧠\n\n💡 ${knowledge}\n\n(ตัวชาวีรู้เรื่องเยอะ ใครไม่หลงตัวชาวี)`;

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

async function askGroq(userText, { isRandom = false } = {}, retries = 3) {
  const userContent = isRandom
    ? `${RANDOM_REPLY_INSTRUCTION}\n\nข้อความที่เพื่อนพิมพ์: "${userText}"`
    : userText;

  const maxTokens = Math.random() < 0.5 ? 300 : 550;

  for (let i = 0; i < retries; i++) {
    try {
      const message = await groq.chat.completions.create({
        model: 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        temperature: 0.7,
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

  extractName(event);

  if (!triggered && Math.random() >= RANDOM_REPLY_RATE) {
    return null;
  }

  let replyText;
  if (Math.random() < 0.15) {
    replyText = getRandomQuote();
  } else {
    try {
      replyText = await askGroq(userText, { isRandom: !triggered });
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

app.post('/webhook', (req, res) => {
  console.log('Webhook received:', JSON.stringify(req.body, null, 2));

  if (!req.body.events || req.body.events.length === 0) {
    console.log('No events in webhook');
    return res.status(200).end();
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

  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.status(200).end())
    .catch((err) => {
      console.error('Webhook error:', err);
      res.status(500).end();
    });
});

app.get('/', (req, res) => {
  res.send('Chawee LINE bot is running.');
});

// Schedule daily knowledge: random time between 8:00-17:00
function scheduleDailyKnowledge() {
  const hours = Array.from({ length: 10 }, (_, i) => i + 8);

  hours.forEach((hour) => {
    const minute = Math.floor(Math.random() * 60);
    cron.schedule(
      `${minute} ${hour} * * *`,
      () => {
        console.log(`⏰ Sending daily knowledge at ${hour}:${String(minute).padStart(2, '0')} (Asia/Bangkok)`);
        sendDailyKnowledge();
      },
      { timezone: 'Asia/Bangkok' }
    );
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Chawee bot listening on port ${PORT}`);
  scheduleDailyKnowledge();
  console.log('Daily knowledge scheduler started (8:00-17:00)');
});
