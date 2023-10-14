import { Context } from "@netlify/functions";
import { JSDOM } from "jsdom";

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
  const { items: articles } = JSON.parse(
    newsJsonAsText.replace(new RegExp('\\"', "g"), '"')
  );

  return new Response(JSON.stringify({ articles }, undefined, 2));
};
