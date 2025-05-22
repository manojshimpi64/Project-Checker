const puppeteer = require("puppeteer");
const cheerio = require("cheerio");

async function analyzeWebsite(url) {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto(url);
  const html = await page.content();
  await browser.close();

  const $ = cheerio.load(html);

  // Finding comments
  const comments = [];
  $("*")
    .contents()
    .filter(function () {
      return this.nodeType === 8; // Comment node
    })
    .each(function (i, el) {
      comments.push({
        line: $(el).parent().html().split("\n").indexOf(el.data) + 1,
        path: url,
        pageName: url.split("/").pop(),
        type: "Comment",
        issue: el.data.trim(),
      });
    });

  // Finding missing alt tags in images
  const missingAltTags = [];
  $("img").each(function (i, el) {
    if (!$(el).attr("alt")) {
      missingAltTags.push({
        line: $(el).parent().html().split("\n").indexOf($(el).toString()) + 1,
        path: url,
        pageName: url.split("/").pop(),
        type: "Missing Alt Tag",
        issue: $(el).attr("src"),
      });
    }
  });

  return { comments, missingAltTags };
}
