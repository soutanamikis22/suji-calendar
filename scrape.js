const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

// カレンダーに登録するイベントのリスト
const events = [];

// 日付判定の正規表現
// 例: 5/19, 5月19日, 2026.05.19, 2026/05/19, 5/19(火)
const datePatterns = [
  /(\d{4})[-./](\d{1,2})[-./](\d{1,2})/g, // 2026-05-19 or 2026.05.19
  /(\d{1,2})[-./](\d{1,2})/g,            // 5/19
  /(\d{1,2})月(\d{1,2})日/g              // 5月19日
];

// 相対日付表現の判定
const relativePatterns = [
  { pattern: /今日/g, offset: 0 },
  { pattern: /明日/g, offset: 1 },
  { pattern: /明後日/g, offset: 2 }
];

// 運行関連のキーワード
const railwayKeywords = ['回送', '試運転', '配給', '入場', '出場', '工臨', '甲種', '輸送', 'スジ', '検測', '集約', '団臨', '客臨', '臨', 'ウヤ', 'レ', 'M', 'D'];

// スジ情報の妥当性をチェックするバリデーター
function isValidSuji(text) {
  // 雑談ノイズの除外ワード（文句や愚痴などのツイートを弾く）
  const noiseWords = ['死刑', '黙れ', '勝手にしろ', '汚いですね', '洗っているのだろうか', 'ガセ', '勝手に思っときな'];
  const hasNoise = noiseWords.some(nw => text.includes(nw));
  if (hasNoise) return false;

  // 時刻を表すパターンの検出 (例: 12:34, 1350-51, 12時34分, 4桁数値)
  const timeRegex = /(?:\b\d{1,2}[:：]\d{2}\b|\b\d{4}\b|\b\d{1,2}時\d{2}分\b)/g;
  const timeMatches = text.match(timeRegex) || [];
  
  // スジ情報（時刻表）なら、途中の経由時刻が少なくとも2箇所以上はあるはず
  const hasMultipleTimes = timeMatches.length >= 2;
  
  // 運行に関わるキーワードが1つ以上含まれているか
  const hasKeyword = railwayKeywords.some(kw => text.includes(kw));
  
  return hasMultipleTimes && hasKeyword;
}

// スジ情報（時刻表）を綺麗に自動改行してフォーマットする関数
function formatSujiText(text) {
  let formatted = text.trim();
  
  // 1. 列車番号 (回XXXX, 配XXXX, 試XXXX, 臨XXXX, 9XXXM, レ, ヨ など) の直前に改行を入れる
  formatted = formatted.replace(/\s*(回\d+[M|D]?|配\d+[M|D]?|試\d+[M|D]?|単\d+[M|D]?|臨\d+[M|D]?|[\d]{3,4}[M|D|レ|ヨ]|[\d]{4}G|[\d]{4}F)\b/gi, '\n$1');
  
  // 2. スペースで区切ってトークンをスキャンし、駅名＋時刻のパターンを検出して適切に改行する
  const tokens = formatted.split(/\s+/);
  const newTokens = [];
  
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;
    
    // トークンが「駅名+時刻（4桁数字や範囲、XX:XX）」になっている場合 (例: "南浦和1329", "大宮1325-34", "吹貨西5::12")
    const m = token.match(/^([\u30a0-\u30ff\u3040-\u309f\u4e00-\u9fafA-Za-z0-9_（）\(\)\/\-\+]+?)(\d{4}(?:-\d{2,4})?|\d{1,2}[:：]+\d{2}(?:-\d{1,2}[:：]+\d{2})?|\d{1,2}時\d{2}分?)(.*)$/);
    
    if (m) {
      const station = m[1];
      const time = m[2];
      const extra = m[3] || '';
      
      // 駅名部分が純粋な数字でない場合のみ
      if (isNaN(station) && station.length > 0) {
        newTokens.push(`\n${station} ${time}${extra}`);
        continue;
      }
    }
    
    // 列車番号トークン単体の場合も改行を付与
    if (/^(回\d+[M|D]?|配\d+[M|D]?|試\d+[M|D]?|単\d+[M|D]?|臨\d+[M|D]?|[\d]{3,4}[M|D|レ|ヨ]|[\d]{4}G|[\d]{4}F)$/i.test(token)) {
      newTokens.push(`\n${token}`);
    } else {
      newTokens.push(token);
    }
  }
  
  let finalResult = newTokens.join(' ')
    .replace(/ \n/g, '\n')
    .replace(/\n /g, '\n')
    .replace(/\n+/g, '\n')
    .trim();
    
  return finalResult;
}

function parseTweet(tweetText, tweetCreatedAt) {
  // スジ情報としての最低限の妥当性がないものは早期除外
  if (!isValidSuji(tweetText)) return null;

  const tweetLines = tweetText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  if (tweetLines.length === 0) return null;

  // ツイート投稿日を基準にする
  const postDate = tweetCreatedAt ? new Date(tweetCreatedAt) : new Date();
  const currentYear = postDate.getFullYear();

  let targetDate = null;
  let foundDate = false;
  
  // 1. 絶対日付の抽出
  // まず "2026/05/19" 形式を探す
  let match = datePatterns[0].exec(tweetText);
  if (match) {
    targetDate = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
    foundDate = true;
  }
  
  // 次に "5/19" や "5月19日" 形式を探す
  if (!foundDate) {
    for (let i = 1; i < datePatterns.length; i++) {
      datePatterns[i].lastIndex = 0; // reset regex
      match = datePatterns[i].exec(tweetText);
      if (match) {
        let month = parseInt(match[1]);
        let day = parseInt(match[2]);
        
        let year = currentYear;
        if (postDate.getMonth() === 11 && month === 1) year += 1;
        if (postDate.getMonth() === 0 && month === 12) year -= 1;

        targetDate = new Date(year, month - 1, day);
        foundDate = true;
        break;
      }
    }
  }

  // 2. 相対日付の抽出
  if (!foundDate) {
    for (const rel of relativePatterns) {
      if (rel.pattern.test(tweetText)) {
        targetDate = new Date(postDate);
        targetDate.setDate(postDate.getDate() + rel.offset);
        foundDate = true;
        break;
      }
    }
  }

  if (!foundDate || isNaN(targetDate.getTime())) {
    return null; // 日付が判別できないものは除外
  }

  // 日付のフォーマット (YYYY-MM-DD)
  const yyyy = targetDate.getFullYear();
  const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
  const dd = String(targetDate.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  // 不要な情報（ハッシュタグ、URLなど）を削除して綺麗にする
  let cleanLines = tweetLines.map(line => {
    return line
      .replace(/#\S+/g, '') // ハッシュタグ削除
      .replace(/https?:\/\/\S+/g, '') // URL削除
      .replace(/pic\.twitter\.com\/\S+/g, '') // 画像URL削除
      .replace(/pic\.x\.com\/\S+/g, '') // 画像URL削除
      .trim();
  }).filter(line => line.length > 0);

  if (cleanLines.length === 0) return null;

  // Yahoo!リアルタイム検索では改行がスペースに消滅しているため、
  // スペース結合したクリーンテキストを強固なアルゴリズムで改行付きに自動再フォーマットします！
  const formattedDetails = formatSujiText(cleanLines.join(' '));
  const detailsLines = formattedDetails.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // タイトルは最初の1行目をベースにする
  let firstLine = detailsLines[0] || '';
  firstLine = firstLine
    .replace(/\d{4}[-./]\d{1,2}[-./]\d{1,2}/g, '')
    .replace(/\d{1,2}[-./]\d{1,2}/g, '')
    .replace(/\d{1,2}月\d{1,2}日/g, '')
    .replace(/\(\w\)/g, '') // 曜日の削除
    .replace(/今日|明日|明後日/g, '')
    .trim();

  let title = firstLine || detailsLines[0] || 'スジ情報';
  if (title.length > 65) {
    title = title.substring(0, 65) + '...';
  }

  return {
    date: dateStr,
    title: title,
    details: formattedDetails,
    rawText: tweetText
  };
}

async function scrapeYahooRealtime() {
  console.log('Yahoo!リアルタイム検索から「#スジ公開」の情報を取得中...');
  const url = 'https://search.yahoo.co.jp/realtime/search?p=%23%E3%82%B9%E3%82%B8%E5%85%AC%E9%96%8B';
  
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    
    const html = await res.text();
    fs.writeFileSync('temp.html', html, 'utf-8'); // デバッグ用
    const $ = cheerio.load(html);
    
    let rawTweets = [];

    // Yahoo!リアルタイム検索のJSONデータでは改行がスペースに置換されてしまうため、
    // 改行(<br>)を「\n」に正確に置換できるDOMスクレイピングのみを常に実行します。
    console.log('DOM解析を開始します...');
    $('p[class*="Tweet_body"]').each((i, el) => {
      const textEl = $(el);
      
      // <br> タグを改行文字に変えて改行を維持！
      textEl.find('br').replaceWith('\n');
      const text = textEl.text().trim();
      
      // 親コンテナ（ツイート全体）を探す
      const tweetContainer = textEl.closest('div[class*="Tweet_overall"], div[class*="TweetContainer"]');
      
      let user = 'Unknown';
      let timeText = '';
      let dateVal = new Date();
      let tweetUrl = ''; // 元ツイートのURLを保持する変数
      
      if (tweetContainer.length > 0) {
        const userEl = tweetContainer.find('[class*="Tweet_authorName"]');
        if (userEl.length) {
          user = userEl.text().trim();
        }
        
        const timeEl = tweetContainer.find('time, [class*="Tweet_time"]');
        if (timeEl.length) {
          timeText = timeEl.text().trim();
          
          if (timeText.includes('分前')) {
            const min = parseInt(timeText);
            dateVal.setMinutes(dateVal.getMinutes() - min);
          } else if (timeText.includes('時間前')) {
            const hr = parseInt(timeText);
            dateVal.setHours(dateVal.getHours() - hr);
          } else if (timeText.includes('昨日')) {
            dateVal.setDate(dateVal.getDate() - 1);
          } else if (timeText.includes('月') && timeText.includes('日')) {
            const m = timeText.match(/(\d+)月(\d+)日/);
            if (m) {
              dateVal.setMonth(parseInt(m[1]) - 1);
              dateVal.setDate(parseInt(m[2]));
            }
          }
        }

        // 投稿時刻へのアンカーリンクなどから元ツイート/情報元の直リンクを自動抽出
        const timeLink = tweetContainer.find('a[href*="twitter.com"], a[href*="x.com"], a[href*="realtime.yahoo.co.jp"], a[class*="Tweet_time"]');
        if (timeLink.length) {
          tweetUrl = timeLink.attr('href') || '';
        }
        if (!tweetUrl) {
          // コンテナ内の全リンクを走査し、Twitter/Xへの転送リンクを特定
          tweetContainer.find('a').each((_, aEl) => {
            const href = $(aEl).attr('href') || '';
            if (href.includes('twitter.com') || href.includes('x.com') || href.includes('realtime.yahoo.co.jp')) {
              tweetUrl = href;
            }
          });
        }
      }
      
      rawTweets.push({
        text: text,
        createdAt: dateVal.toISOString(),
        user: user,
        url: tweetUrl // URLをプールに追加
      });
    });
    console.log(`DOM解析から ${rawTweets.length} 件のツイートを検出しました。`);

    // 重複排除とスジ情報の解析
    const parsedEvents = [];
    const seenTexts = new Set();

    for (const tweet of rawTweets) {
      if (seenTexts.has(tweet.text)) continue;
      seenTexts.add(tweet.text);

      const event = parseTweet(tweet.text, tweet.createdAt);
      if (event) {
        event.user = tweet.user;
        event.url = tweet.url || ''; // 解析されたイベントに元リンクを紐付け
        parsedEvents.push(event);
      }
    }

    console.log(`解析完了: 日付が判別できたスジ情報 ${parsedEvents.length} 件`);

    // 日付順にソート
    parsedEvents.sort((a, b) => new Date(a.date) - new Date(b.date));

    // 保存ディレクトリ（public）の作成と書き出し
    const publicDir = path.join(__dirname, 'public');
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }
    const publicPath = path.join(publicDir, 'suji-data.json');
    fs.writeFileSync(publicPath, JSON.stringify(parsedEvents, null, 2), 'utf-8');
    console.log(`[Vite開発用] データを保存しました: ${publicPath}`);

    // [GitHub Pages静的公開用] ルート直下にも同時に保存！
    const rootPath = path.join(__dirname, 'suji-data.json');
    fs.writeFileSync(rootPath, JSON.stringify(parsedEvents, null, 2), 'utf-8');
    console.log(`[GitHub Pages用] データを保存しました: ${rootPath}`);

  } catch (error) {
    console.error('スクレイピングエラー:', error);
  }
}

scrapeYahooRealtime();
