import { startBrowser } from './browser.js';
import { signIn } from './signIn.js';
import util from './util.js';
import * as dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

if (!process.env.KV_USERNAME || !process.env.KV_PASSWORD) {
  console.error(
    'Missing KV_USERNAME or KV_PASSWORD in environment. Did you create a .env file in this directory and include these?'
  );
  process.exit(1);
}

let args = process.argv;
if ((args[0] = ~/node$/)) {
  args = args.slice(2);
} else if ((args[0] = ~/npm$/)) {
  args = args.slice(3);
}

let downloadPath = util.getArgValue(args, '-d');
let headless = args.includes('-h') || args.includes('--headless');
let pitch = parseInt(util.getArgValue(args, '-p'));
let fileName = args.find((arg) => !arg.startsWith('-'));

async function processUrl(songUrl) {
  console.log(`Starting for song page: ${songUrl}`);

  const browser = await startBrowser({ headless: headless });
  const page = await browser.newPage();

  if (downloadPath) {
    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloadPath,
    });
  }

  console.log('Signing in...');
  const domain = new URL(songUrl).hostname;
  await page.setViewport({ width: 1080, height: 1024 });

  await signIn(page, domain, process.env.KV_USERNAME, process.env.KV_PASSWORD);

  console.log(`Starting for song page: ${songUrl}`);
  await page.goto(songUrl);

  await util.sleep(6000);

  page.setDefaultTimeout(120000);

  // LOAD SONG

  console.log(`Starting for song page: ${songUrl}`);
  await page.goto(songUrl);

  await util.sleep(6000);

  page.setDefaultTimeout(120000);

  if (!Number.isNaN(pitch)) {
    // pitch is remembered per-song on your account, so this
    // logic can't be deterministic. Instead we'll try to infer which
    // direction we need to go based on what the pitch is currently set to.
    const pitchLabel = await page.waitForSelector('span.pitch__value');
    const currentPitch = parseInt(
      await pitchLabel.evaluate((el) => el.innerText)
    );

    console.log(`Setting pitch to ${pitch})`);
    console.log(`Pitch is currently set to ${currentPitch}`);

    const pitchUpButton = await page.waitForSelector(
      "div.pitch button.btn--pitch[title='Key up']"
    );
    const pitchDownButton = await page.waitForSelector(
      "div.pitch button.btn--pitch[title='Key down']"
    );
    let diff = pitch - currentPitch;

    let button = diff < 0 ? pitchDownButton : pitchUpButton;
    for (let index = 0; index < Math.abs(diff); index++) {
      console.debug('adjusting pitch');
      button.click();
    }
    if (diff != 0) {
      // need to reload after pitching
      (await page.waitForSelector('a#pitch-link')).click();
      await util.sleep(4000);
    }
  }

  const soloButtonSelector = '.track__controls.track__solo';
  let soloButtons = await page.$$(soloButtonSelector);
  let trackNames = await page.$$('.mixer .track .track__caption');

  let i = 1;
  let downloadButton = await page.waitForSelector('a.download');
  for (const soloButton of soloButtons) {
    // the click track also has the intro element, so we need to extract just the text
    const trackName = await trackNames[i - 1].evaluate((el) =>
      el.lastChild.nodeValue.trim()
    );
    console.log(`soloing track ${i} of ${soloButtons.length} (${trackName})`);
    await soloButton.click();
    await util.sleep(3000);
    await downloadButton.click();
    console.log('Waiting for download...');
    await util.sleep(3000);
    await page.waitForSelector(
      'text/Der Download beginnt in wenigen Sekunden...'
    );
    await util.sleep(3000);

    const closeModalButton = await page.waitForSelector(
      'button.js-modal-close'
    );
    console.log('closing modal...');
    await util.sleep(3000);
    await closeModalButton.click();

    await util.sleep(10000);

    i += 1;
  }

  console.log('Done!');
  await browser.close();
}

fs.readFile(fileName, 'utf8', async (err, data) => {
  if (err) {
    console.error(err);
    return;
  }

  const urls = data.split('\n');

  for (const url of urls) {
    console.log(`Starting download for ${url}`);
    await processUrl(url);
    console.log(`Finished download for ${url}`);
  }
});
