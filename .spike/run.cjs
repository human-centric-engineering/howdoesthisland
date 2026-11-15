// t-31 spike (temporary): time headless Chromium rendering the report's
// print page to PDF inside the runtime image. Removed before merge.
const { createRequire } = require('node:module');
const { readFileSync, statSync, readdirSync } = require('node:fs');
const req = createRequire('/app/server.js');
const puppeteer = req('puppeteer-core');

const html = readFileSync('/spike/print-fixture.html', 'utf8');
const exe = process.env.PDF_CHROMIUM_PATH;

(async () => {
  console.log('executable', exe, statSync(exe).isFile());
  console.log(
    'chromium-ish in /usr/bin:',
    readdirSync('/usr/bin').filter((f) => f.startsWith('chrom'))
  );
  const runs = [];
  for (let i = 0; i < 4; i++) {
    const t0 = Date.now();
    const browser = await puppeteer.launch({
      executablePath: exe,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--font-render-hinting=none',
      ],
    });
    const t1 = Date.now();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const t2 = Date.now();
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="font-size:8px;width:100%;text-align:right;padding:0 16mm"><span class="pageNumber"></span></div>',
    });
    const t3 = Date.now();
    if (i === 0) console.log('version', await browser.version());
    await browser.close();
    runs.push({
      launch: t1 - t0,
      load: t2 - t1,
      pdf: t3 - t2,
      total: Date.now() - t0,
      bytes: pdf.length,
    });
  }
  console.table(runs);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
