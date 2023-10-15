import { Context } from "@netlify/functions";
import { JSDOM } from "jsdom";
import { Redis } from "@upstash/redis";
import { toDate, format as formatDateFns, utcToZonedTime } from "date-fns-tz";
import { escapeHTML } from "../../utils";

const TZ = process.env["TZ"] || "Asia/Jerusalem";
const TELEGRAM_BOT_TOKEN = process.env["TELEGRAM_BOT_TOKEN"]!;
const TELEGRAM_CHAT_ID = process.env["TELEGRAM_CHAT_ID"]!;

const redis = new Redis({
  url: process.env["UPSTASH_URL"]!,
  token: process.env["UPSTASH_TOKEN"]!,
});
const REDIS_LAST_SEEN_ARTICLE_ID_KEY = "lastSeenArticleId";

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
    "dd/MM/yyyy בשעה HH:mm:ss",
    { timeZone: "Asia/Jerusalem" }
  );
  const message = `<b>🌟 <a href="${article.shareUrl}">מבזק</a> מ-${escapeHTML(
    formattedDateTime
  )}:</b>\n<b>${escapeHTML(article.title)}</b>\n${escapeHTML(article.text)}`;
  const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const requestBody = JSON.stringify({
    text: message,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    chat_id: TELEGRAM_CHAT_ID,
  });
  const timingLabel = `POST ${telegramApiUrl.replace(
    TELEGRAM_BOT_TOKEN,
    "***"
  )} for article ${article.articleId}`;
  console.time(timingLabel);
  console.log(`${timingLabel} body: ${requestBody}`);
  const telegramResponse = await fetch(telegramApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: requestBody,
  });
  console.timeEnd(timingLabel);
  console.log(`${timingLabel} returned status ${telegramResponse.status}`);
  if (telegramResponse.status < 200 || telegramResponse.status >= 300) {
    console.log(
      `${timingLabel} returned body: ${await telegramResponse.text()}`
    );
    throw Error(
      `Telegram sendMessage returned status ${telegramResponse.status}`
    );
  }
}

async function getNewsFeedHTML(): Promise<string> {
  const newsFeedUrl = "https://www.ynet.co.il/news/category/184";
  const timingLabel = `GET ${newsFeedUrl}`;
  console.time(timingLabel);
  const newsResponseText = await (
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
  console.timeEnd(timingLabel);
  return newsResponseText;
}

function parseNews(newsResponseText: string): Article[] {
  const timingLabel = "parseNews";
  console.time(timingLabel);
  const newsFeedDOM = new JSDOM(newsResponseText);
  const SCRIPT_REGEX = new RegExp(
    /^\w*window\.YITSiteWidgets\.push\(\['[a-zA-Z0-9]+', *'Accordion', *(\{.+\})\]\);$/
  );
  const newsJsonAsText = Array.from(
    newsFeedDOM.window.document.getElementsByTagName("script")
  )
    .filter((elm) => elm.innerHTML.match(SCRIPT_REGEX))[0]
    .innerHTML.match(SCRIPT_REGEX)![1];
  const news = JSON.parse(
    newsJsonAsText.replace(new RegExp('\\"', "g"), '"')
  ).items.map(({ date, ...obj }) => ({
    ...obj,
    date: utcToZonedTime(toDate(date), TZ),
  }));
  console.timeEnd(timingLabel);
  return news;
}

async function dropSeenArticles(articles: Article[]) {
  const timingLabel = `Get ${REDIS_LAST_SEEN_ARTICLE_ID_KEY}`;
  console.time(timingLabel);
  const lastSeenArticleId =
    (await redis.get<string>(REDIS_LAST_SEEN_ARTICLE_ID_KEY)) ||
    articles[Math.min(articles.length, 6)].articleId;
  console.timeEnd(timingLabel);
  return articles
    .slice(
      0,
      articles.findIndex((article) => article.articleId === lastSeenArticleId)
    )
    .sort((a1, a2) => a1.date.getTime() - a2.date.getTime());
}

async function sendNewArticlesViaTelegram(articles: Article[]) {
  for (const newArticle of articles) {
    await sendArticleViaTelegram(newArticle);
  }
}

async function updateLastSeenArticleId(newLastSeenArticleId: string) {
  const timingLabel = `Set ${REDIS_LAST_SEEN_ARTICLE_ID_KEY}`;
  console.time(timingLabel);
  await redis.set(REDIS_LAST_SEEN_ARTICLE_ID_KEY, newLastSeenArticleId);
  console.timeEnd(timingLabel);
}

export default async (req: Request, context: Context) => {
  const timingLabel = context.requestId;
  console.time(timingLabel);
  const newsResponseText = await getNewsFeedHTML();
  const articles = parseNews(newsResponseText);
  const newArticles = await dropSeenArticles(articles);
  await sendNewArticlesViaTelegram(newArticles);
  await updateLastSeenArticleId(articles[0].articleId);
  const response = new Response(JSON.stringify({ newArticles }, undefined, 2));
  console.timeEnd(timingLabel);
  return response;
};
