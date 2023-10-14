import { Context } from "@netlify/functions";
import { JSDOM } from "jsdom";
import { Redis } from "@upstash/redis";
import { parseISO, format as formatDateFns } from "date-fns";

const TELEGRAM_BOT_TOKEN = process.env["TELEGRAM_BOT_TOKEN"]!;
const TELEGRAM_CHAT_ID = process.env["TELEGRAM_CHAT_ID"]!;

const redis = new Redis({
  url: process.env["UPSTASH_URL"]!,
  token: process.env["UPSTASH_TOKEN"]!,
});

type Article = {
  articleId: string;
  date: Date;
  text: string;
  title: string;
  shareUrl: string;
};

async function sendArticleViaTelegram(article: Article) {
  const formattedDateTime = formatDateFns(
    article.date,
    "dd/MM/yyyyy בשעה HH:mm:ss"
  );
  const message = `<b>🌟 <a href="${article.shareUrl}">מבזק</a> מ-${formattedDateTime}:</b>\n<b>${article.title}</b>\n${article.text}`;
  const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const requestBody = JSON.stringify({
    text: message,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    chat_id: TELEGRAM_CHAT_ID,
  });
  console.log(`START POST ${telegramApiUrl}:\n${requestBody}`);
  const telegramResponse = await fetch(telegramApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: message,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      chat_id: TELEGRAM_CHAT_ID,
    }),
  });
  console.log(`END POST ${telegramApiUrl} returned ${telegramResponse.status}`);
  if (telegramResponse.status < 200 || telegramResponse.status >= 300) {
    console.log({
      telegramResponse: {
        body: await telegramResponse.text(),
      },
    });
    throw Error(
      `Telegram sendMessage returned status ${telegramResponse.status}`
    );
  }
}

export default async (req: Request, context: Context) => {
  const rssFeedResponseText = await (
    await fetch("https://www.ynet.co.il/news/category/184", {
      headers: {
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "accept-language": "en-US,en;q=0.9,he;q=0.8",
        "cache-control": "no-cache",
        pragma: "no-cache",
        "sec-ch-ua": '"Chromium";v="117", "Not;A=Brand";v="8"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "none",
        "sec-fetch-user": "?1",
        "upgrade-insecure-requests": "1",
      },
      referrerPolicy: "strict-origin-when-cross-origin",
      body: null,
      method: "GET",
      mode: "cors",
      credentials: "include",
    })
  ).text();
  const rssFeedDOM = new JSDOM(rssFeedResponseText);
  const SCRIPT_REGEX = new RegExp(
    /^\w*window\.YITSiteWidgets\.push\(\['[a-zA-Z0-9]+', *'Accordion', *(\{.+\})\]\);$/
  );
  const newsJsonAsText = Array.from(
    rssFeedDOM.window.document.getElementsByTagName("script")
  )
    .filter((elm) => elm.innerHTML.match(SCRIPT_REGEX))[0]
    .innerHTML.match(SCRIPT_REGEX)![1];
  const articles: [Article] = JSON.parse(
    newsJsonAsText.replace(new RegExp('\\"', "g"), '"')
  ).items.map(({ date, ...obj }) => ({
    ...obj,
    date: parseISO(date),
  }));

  const lastSeenArticleId =
    (await redis.get<string>("lastSeenArticleId")) ||
    articles[Math.min(articles.length, 6)].articleId;
  const newArticles = articles
    .slice(
      0,
      articles.findIndex((article) => article.articleId === lastSeenArticleId)
    )
    .sort((a1, a2) => a1.date.getTime() - a2.date.getTime());

  for (const newArticle of newArticles) {
    await sendArticleViaTelegram(newArticle);
  }

  await redis.set("lastSeenArticleId", articles[0].articleId);
  return new Response(JSON.stringify({ newArticles }, undefined, 2));
};
