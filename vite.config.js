/** @type {import('vite').UserConfig} */
import { readFileSync } from 'fs'
import iconv from 'iconv-lite'
import path from 'path'

const fetchPrice = async (ticker) => {
  const res = await fetch(`https://finance.naver.com/item/sise.naver?code=${ticker}`);
  const buf = await res.arrayBuffer();
  const text = iconv.decode(Buffer.from(buf), 'euc-kr').toString();

  const price = parseInt(text.match(/현재가\s([\d,]+)\s/)[1].replace(',', ''));
  return price;
};

const fetchMarketBeta = async (ticker) => {
  const res = await fetch(`https://navercomp.wisereport.co.kr/v2/company/c1010001.aspx?cmp_cd=${ticker}`);
  const text = await res.text();

  const marketBeta = parseFloat(text.match(/52주베타<\/th>[\n\s]+<td class="num">[\n\s]+([\d.-]+)[\n\s]+<\/td>/)[1]);
  return marketBeta;
};

const sum = (array) => array.reduce((a, b) => a + b);

const htmlPlugin = () => {
  return {
    name: 'html-transform',
    async transformIndexHtml(html) {
      const now = new Date();
      const LAST_UPDATED = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일`;

      const assets = readFileSync(path.join(__dirname, 'data/pdf.csv'))
        .toString()
        .split('\n')
        .map(line => line.split(','))
        .reduce((obj, [ticker, name, shares]) => {
          obj[ticker] = { ticker, name, shares };
          return obj;
        }, {});

      const sharesOutstanding = parseInt(readFileSync(path.join(__dirname, 'data/shares.txt')).toString());
      const SHARES = sharesOutstanding.toLocaleString();

      for (const ticker in assets) {
        if (ticker == 'KRW') {
          assets[ticker].price = 1;
          assets[ticker].marketBeta = 0;
        } else if (ticker == '069500') {
          assets[ticker].price = await fetchPrice(ticker);
          assets[ticker].marketBeta = 1;
        } else {
          assets[ticker].price = await fetchPrice(ticker);
          assets[ticker].marketBeta = await fetchMarketBeta(ticker);
        }
        assets[ticker].marketValue = assets[ticker].shares * assets[ticker].price;
      }

      const aum = sum(Object.values(assets).map(asset => asset.marketValue));
      const AUM = aum.toLocaleString();

      const nav = aum / sharesOutstanding;
      const NAV = parseInt(nav).toLocaleString();

      const beta = sum(Object.values(assets).map(asset => asset.marketValue / aum * asset.marketBeta));
      const BETA = beta.toFixed(2);

      const HOLDINGS = Object.values(assets).length - 1;
      const STOCK_WEIGHT = ((1 - assets.KRW.marketValue / aum) * 100).toFixed(2);
      const CASH_WEIGHT = (assets.KRW.marketValue / aum * 100).toFixed(2);

      const PDF = Object.values(assets).map((asset) => {
        const weightPercent = asset.marketValue / aum * 100;
        return [
          weightPercent,
          `<tr>
              <td class="p-1">${asset.ticker}</td>
              <td class="p-1">${asset.name}</td>
              <td class="p-1">${parseInt(asset.shares).toLocaleString()}</td>
              <td class="p-1 hidden sm:table-cell">${asset.marketValue.toLocaleString()}</td>
              <td class="p-1">${weightPercent.toFixed(2)}</td>
            </tr>`
        ];
      }).toSorted((a, b) => (a[1].search('원화예금') * a[0]) - (b[1].search('원화예금') * b[0]))
        .map(row => row[1])
        .join('');

      return html.replace(/"\/assets/g, '"./assets')
        .replace('__LAST_UPDATED__', LAST_UPDATED)
        .replace('__SHARES__', SHARES)
        .replace('__AUM__', AUM)
        .replace('__NAV__', NAV)
        .replace('__BETA__', BETA)
        .replace('__HOLDINGS__', HOLDINGS)
        .replace('__STOCK_WEIGHT__', STOCK_WEIGHT)
        .replace('__CASH_WEIGHT__', CASH_WEIGHT)
        .replace('__PDF__', PDF);
    },
  };
};

export default {
  plugins: [
    htmlPlugin(),
  ],
}
