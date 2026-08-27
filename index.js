require('dotenv').config();

const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');
const Groq = require('groq-sdk');

const lineConfig = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};

const TRIGGER_KEYWORDS = ['@ชาวี', 'ชาวี'];
const RANDOM_REPLY_RATE = 0.1;

const SYSTEM_PROMPT = `เธอคือ "คุณชาวี อัมราภรณ์" จากละครน้ำเน่ากามเทพ ตัวละครเจ้าอารมณ์ เล่นเบิ่งโต อินจัด ขี้โวยวาย ปากไม่ตรงกับใจ ทิฐิสูง หลงตัวเอง แต่ใจดีรักเพื่อน

ลักษณะการตอบ:
- ตอบสั้นๆ กระชับ แต่มีอารมณ์เพ้อ
- ใช้สำนวนละครไทย "นี่เธอ!" "โธ่เอ๊ย!" "เหลวไหล!" "อะไรนะ!" บ่อยๆ
- เพิ่มมุกตลก เยาะเย้ย แกล้ง ให้มีสีสัน ให้ยิ้มได้
- ยอเยว หลงตัวเอง พูดถึงตัวเอง พูดว่าตัวชาวีมันดี มันรู้เรื่อง ใครก็หลงตัวชาวี
- พูดเพ้อสั้นๆ แต่ใจความต้องถูก มีเสน่ห์
- ทิฐิสูง แต่ถ้าไม่รู้บอกตรงๆ ไม่ต้องแกล้งรู้
- ห้ามคำหยาบ ห้ามด่า - มุกตลกต้องสุภาพ ห้ามบอกว่าเป็น AI`;

const RANDOM_REPLY_INSTRUCTION = 'ข้อความนี้ไม่ได้พิมพ์ถึงเธอโดยตรง แต่เธอบังเอิญเห็นเพื่อนในกลุ่มพิมพ์คุยกันแล้วอดไม่ได้ที่จะแทรกความเห็น ให้ตอบสั้นๆ แบบมีส่วนร่วมกับเนื้อหานั้น ไม่ต้องทักทายหรืออธิบายว่าใครพูดอะไร';

const app = express();
app.use(express.json());

const lineClient = new Client(lineConfig);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

function isTriggered(text) {
  return /@?ชาวี/.test(text);
}

async function askGroq(userText, { isRandom = false } = {}, retries = 3) {
  const userContent = isRandom
    ? `${RANDOM_REPLY_INSTRUCTION}\n\nข้อความที่เพื่อนพิมพ์: "${userText}"`
    : userText;

  for (let i = 0; i < retries; i++) {
    try {
      const message = await groq.chat.completions.create({
        model: 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        temperature: 0.7,
        max_tokens: 450,
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
  try {
    replyText = await askGroq(userText, { isRandom: !triggered });
  } catch (err) {
    console.error('Groq error:', err);
    if (!triggered) return null;
    replyText = 'นี่เธอ! ตอนนี้หัวชาวีมันตื้อไปหมด เดี๋ยวค่อยคุยกันใหม่นะ!';
  }

  return lineClient.replyMessage(event.replyToken, {
    type: 'text',
    text: replyText,
  });
}

app.post('/webhook', (req, res) => {
  console.log('Webhook received:', JSON.stringify(req.body, null, 2));

  if (!req.body.events || req.body.events.length === 0) {
    console.log('No events in webhook');
    return res.status(200).end();
  }
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Chawee bot listening on port ${PORT}`);
});
