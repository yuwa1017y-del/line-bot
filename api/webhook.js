import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { google } from 'googleapis';
import crypto from 'crypto';

if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();
const SPREADSHEET_ID = '18t43VJbEK9KK6SZSosefBgPp_JNPY9WgzJ1A0a2FFFk';
const SHEET_NAME = '流入表';

async function getSheets() {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function appendToSheet(values) {
  try {
    const sheets = await getSheets();
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:K`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [values] },
    });
  } catch (e) {
    console.error('appendToSheet error:', e.message);
  }
}

async function updateSheet(lineUserId, column, value) {
  try {
    const sheets = await getSheets();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:A`,
    });
    const rows = res.data.values || [];
    const rowIndex = rows.findIndex(row => row[0] === lineUserId);
    if (rowIndex === -1) return;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!${column}${rowIndex + 1}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[value]] },
    });
  } catch (e) {
    console.error('updateSheet error:', e.message);
  }
}

async function processEvents(events) {
  for (const event of events) {

    if (event.type === 'follow') {
      const userId = event.source.userId;
      const today = new Date().toLocaleDateString('ja-JP');
      await db.collection('users').doc(userId).set({
        userId,
        step: 'ask_name',
        createdAt: new Date(),
      });
      await replyText(event.replyToken,
        `ご追加ありがとうございます✨\nまずお名前（フルネーム）を教えてください😊`
      );
      await appendToSheet([userId, '', '', '', '', today, '', '', '', '', '']);
    }

    if (event.type === 'message' && event.message.type === 'text') {
      const userId = event.source.userId;
      const text = event.message.text.trim();
      const userRef = db.collection('users').doc(userId);
      const userDoc = await userRef.get();
      if (!userDoc.exists) continue;
      const userData = userDoc.data();

      if (userData.step === 'ask_name') {
        const normalized = text.replace(/\s+/g, '');
        await userRef.update({ step: 'ask_mixi_id', name: normalized });
        await replyText(event.replyToken, `ありがとうございます！\n次にミクチャIDを教えてください😊`);
        await updateSheet(userId, 'C', normalized);
        await updateSheet(userId, 'G', '✅');

      } else if (userData.step === 'ask_mixi_id') {
        await userRef.update({ step: 'ask_contest', mixiId: text });
        await replyText(event.replyToken, `ありがとうございます！\n参加するコンテスト名を教えてください😊`);
        await updateSheet(userId, 'B', text);

      } else if (userData.step === 'ask_contest') {
        await userRef.update({ step: 'ask_route', contestName: text });
        await replyQuickReply(event.replyToken,
          `ご入力ありがとうございます！\n正式にKIRINZ公認ライバーとしての権利が付与されています！\n\n15〜20分ほどお話しできればと思います📞\nご希望の方法を選んでください👇`,
          [
            { label: '📞 電話で進める', text: '電話予約をします' },
            { label: '💬 テキストで進める', text: 'メッセージ希望' },
          ]
        );
        await updateSheet(userId, 'D', text);
        await updateSheet(userId, 'E', '流入');

      } else if (userData.step === 'ask_route') {
        if (text === '電話予約をします') {
          await userRef.update({ step: 'wait_reservation' });
          await replyQuickReply(event.replyToken,
            `下記URLよりご希望の日時をお選びください📅\n👇 電話予約（15分）はこちら 👇\nhttps://calendar.app.google/n8hMyTNboADqz7qeA\n\n予約が完了したら下のボタンを押してください👇`,
            [{ label: '✅ 予約完了しました', text: '予約完了しました' }]
          );
          await updateSheet(userId, 'E', '電話待ち');

        } else if (text === 'メッセージ希望') {
          await userRef.update({ step: 'text_route' });
          await replyQuickReply(event.replyToken,
            `かしこまりました！\nまずは下記Notionをご確認ください！\nhttps://www.notion.so/KIRINZ-1c1c2236f4f880a39313fadac6184719\n\n✅ 頑張りに応じた報酬＋事務所特典あり🎁\n✅ 登録料・違約金一切なし\n✅ システム登録が報酬受け取りに必須\n\n内容をご確認いただけましたら👇`,
            [{ label: '✅ 内容を確認・同意しました', text: '内容を確認・同意しました' }]
          );
          await updateSheet(userId, 'J', '✅');
          await updateSheet(userId, 'E', 'メッセ対応中');
        }

      } else if (userData.step === 'wait_reservation' && text === '予約完了しました') {
        await userRef.update({ step: 'wait_form' });
        await replyText(event.replyToken,
          `予約確認できました✨ 当日はよろしくお願いします！\n\nお電話をスムーズに進めるために事前に資料を共有します😊\n📝 重要事項：https://www.notion.so/KIRINZ-1c1c2236f4f880a39313fadac6184719\n📝 登録フォーム：https://kirinz-form.studio.site/kirinz/mc\n\n登録まで完了したら下のボタンを押してください👇`
        );
        await updateSheet(userId, 'E', '面談待ち');

      } else if (userData.step === 'text_route' && text === '内容を確認・同意しました') {
        await userRef.update({ step: 'ask_plan' });
        await replyQuickReply(event.replyToken,
          `ありがとうございます！\n報酬プランを選んでください😊\n\n1️⃣【成果型】ギフティングに応じた報酬。自分のペースで配信したい方に！\n2️⃣【ランク型】毎日長時間配信できる上級者向けプラン`,
          [
            { label: '🌟 成果型で進める', text: '成果型希望' },
            { label: '👑 ランク型で進める', text: 'ランク型希望' },
          ]
        );

      } else if (userData.step === 'ask_plan' && (text === '成果型希望' || text === 'ランク型希望')) {
        await userRef.update({ step: 'wait_form', plan: text });
        await replyQuickReply(event.replyToken,
          `ありがとうございます！\n下記フォームより登録をお願いします📝（5分ほどで完了します✨）\n👇 システム登録フォーム 👇\nhttps://kirinz-form.studio.site/kirinz/mc\n\n⚠️ 口座情報・ID・所属規約の確認をお忘れなく！\n\n入力が完了したら👇`,
          [{ label: '📝 フォーム入力完了！', text: 'フォーム入力完了しました' }]
        );

      } else if (text === 'フォーム入力完了しました') {
        const today = new Date().toLocaleDateString('ja-JP');
        await userRef.update({ step: 'completed' });
        await replyText(event.replyToken,
          `フォーム回答ありがとうございます！\nこれをもって正式にKIRINZ公認ライバーとしての活動スタートです！🚀\n\n🚨【超重要】今後のサポートや報酬は専属の「マネジメントLINE」で行います。\n👇 マネジメントLINE＠はこちら👇\nhttps://lin.ee/UDmmitb\n\n追加後すぐに届く「初期連携フォーム」にご登録ください🎁`
        );
        await updateSheet(userId, 'E', '契約完了');
        await updateSheet(userId, 'K', today);
      }
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ status: 'webhook endpoint' });
  }

  const signature = req.headers['x-line-signature'];
  const body = JSON.stringify(req.body);
  const hash = crypto
    .createHmac('SHA256', process.env.LINE_CHANNEL_SECRET)
    .update(body)
    .digest('base64');

  if (hash !== signature) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const events = req.body.events || [];
  console.log('EVENTS:', JSON.stringify(events));

  try {
    await processEvents(events);
  } catch (e) {
    console.error('processEvents error:', e.message);
  }

  return res.status(200).json({ status: 'ok' });
}

async function replyText(replyToken, text) {
  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text }],
    }),
  });
  const data = await res.json();
  console.log('replyText result:', JSON.stringify(data));
}

async function replyQuickReply(replyToken, text, items) {
  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{
        type: 'text',
        text,
        quickReply: {
          items: items.map(item => ({
            type: 'action',
            action: { type: 'message', label: item.label, text: item.text },
          })),
        },
      }],
    }),
  });
  const data = await res.json();
  console.log('replyQuickReply result:', JSON.stringify(data));
}
