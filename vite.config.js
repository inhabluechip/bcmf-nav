/** @type {import('vite').UserConfig} */
import { readFileSync } from 'fs'
import { minify } from 'html-minifier-terser';
import tailwindcss from "@tailwindcss/vite";
import { getColor } from 'colorthief';
import * as echarts from 'echarts';
import iconv from 'iconv-lite'
import path from 'path'
import { optimize } from 'svgo';

const fetchCompanyLogoColor = async (ticker) => {
  const res = await fetch(`https://thumb.tossinvest.com/image/resized/48x0/https%3A%2F%2Fstatic.toss.im%2Fpng-icons%2Fsecurities%2Ficn-sec-fill-${ticker}.png`);
  const buf = await res.arrayBuffer();

  const logoColor = getColor(buf, 1, 1);
  return logoColor
};

const fetchMarketPrice = async (ticker) => {
  const res = await fetch(`https://finance.naver.com/item/sise.naver?code=${ticker}`);
  const buf = await res.arrayBuffer();
  const text = iconv.decode(Buffer.from(buf), 'euc-kr').toString();

  const price = parseInt(text.match(/현재가\s([\d,]+)\s/)[1].replace(',', ''));
  return price;
};

const fetchMarketBeta = async (ticker) => {
  const res = await fetch(`https://navercomp.wisereport.co.kr/v2/company/c1010001.aspx?cmp_cd=${ticker}`);
  const text = await res.text();

  let match = text.match(/52주베타<\/th>[\n\s]+<td class="num">[\n\s]*([\d.-]+)[\n\s]*<\/td>/);
  if (!match || !match[1]) {
    match = text.match(/"YR_BETA":"([\d.-]+)"/);
  }
  if (!match || !match[1]) {
    console.warn(`❗Could not find market beta for ticker ${ticker}, defaulting to 1.0`);
    return 1.0;
  }
  return parseFloat(match[1]);
};

const drawDonutChart = (data, width, height) => {
  let chart = echarts.init(null, null, {
    renderer: 'svg',
    ssr: true,
    width: width,
    height: height,
  });
  chart.setOption({
    series: [
      {
        type: 'pie',
        data: data,
        radius: ['40%', '80%'],
        label: { fontFamily: 'Pretendard Variable' },
      },
    ],
    animation: false,
  });
  const svg = optimize(chart.renderToSVGString().replace(`<svg width="${width}" height="${height}"`, '<svg')).data;
  chart.dispose();
  return svg;
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
        .trim()
        .split(/\r?\n|\r|\n/g)
        .map(line => line.split(','))
        .reduce((obj, [ticker, name, shares, priceBuy]) => {
          obj[ticker] = { ticker, name, shares, priceBuy };
          return obj;
        }, {});

      const sharesOutstanding = parseInt(readFileSync(path.join(__dirname, 'data/shares.txt')).toString());
      const SHARES = sharesOutstanding.toLocaleString();

      for (const ticker in assets) {
        // 가격 조회
        if (ticker == 'KRW') { // 현금
          assets[ticker].price = 1;
          assets[ticker].marketBeta = 0;
          assets[ticker].priceReturn = 0;
        } else { // 네이버 증권에서 가격을 가져올 수 있는 종목들
          assets[ticker].price = await fetchMarketPrice(ticker);
          assets[ticker].priceReturn = (assets[ticker].price - assets[ticker].priceBuy) / assets[ticker].priceBuy;
          assets[ticker].marketBeta = await fetchMarketBeta(ticker);
        }
        assets[ticker].marketValue = assets[ticker].shares * assets[ticker].price;

        // 기업 로고 색상 조회
        if (ticker == 'KRW') {
          assets[ticker].logoColor = '#ccc';
        } else {
          const rgbArray = await fetchCompanyLogoColor(ticker);
          assets[ticker].logoColor = `rgb(${rgbArray.join(",")})`;
        }
      }

      const aum = sum(Object.values(assets).map(asset => asset.marketValue));
      const AUM = aum.toLocaleString();

      const nav = aum / sharesOutstanding;
      const NAV = parseInt(nav).toLocaleString();

      // const startingNav = 15248; // 2025년 1월 1일 기준
      const startingNav = 24972; // 2026년 1월 1일 기준
      const YTD_RETURN = `<span class="${nav > startingNav ? 'text-red-500' : ''} ${nav < startingNav ? 'text-blue-500' : ''}">${nav > startingNav ? '+' : ''}${((nav - startingNav) / startingNav * 100).toFixed(2)}%</span>`;

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
              <td class="p-1 hidden md:table-cell">${asset.marketValue.toLocaleString()}</td>
              <td class="p-1 hidden sm:table-cell ${asset.priceReturn > 0 ? 'text-red-500' : ''} ${asset.priceReturn < 0 ? 'text-blue-500' : ''}">${asset.priceReturn > 0 ? '+' : ''}${asset.priceReturn != 0 ? (asset.priceReturn * 100).toFixed(2) : '-'}</td>
              <td class="p-1">${weightPercent.toFixed(2)}</td>
            </tr>`
        ];
      }).toSorted((a, b) => (a[1].search('원화예금') * a[0]) - (b[1].search('원화예금') * b[0]))
        .map(row => row[1])
        .join('');

      const pdfChartData = Object.values(assets)
        .map(asset => ({
          name: asset.name,
          value: (asset.marketValue / aum * 100).toFixed(2),
          itemStyle: { color: asset.logoColor }
        }))
        .sort((a, b) => parseFloat(b.value) - parseFloat(a.value));
      const PDF_CHART = drawDonutChart(pdfChartData, 500, 250);
      const PDF_CHART_MOBILE = drawDonutChart(pdfChartData, 350, 150);

      const htmlInjected = html.replace(/"\/assets/g, '"./assets')
        .replace('__LAST_UPDATED__', LAST_UPDATED)
        .replace('__SHARES__', SHARES)
        .replace('__AUM__', AUM)
        .replace('__NAV__', NAV)
        .replace('__YTD_RETURN__', YTD_RETURN)
        .replace('__BETA__', BETA)
        .replace('__HOLDINGS__', HOLDINGS)
        .replace('__STOCK_WEIGHT__', STOCK_WEIGHT)
        .replace('__CASH_WEIGHT__', CASH_WEIGHT)
        .replace('__PDF__', PDF)
        .replace('__PDF_CHART__', PDF_CHART)
        .replace('__PDF_CHART_MOBILE__', PDF_CHART_MOBILE);

      const htmlMinified = await minify(htmlInjected, { collapseWhitespace: true });
      return htmlMinified;
    },
  };
};

export default {
  plugins: [
    htmlPlugin(),
    tailwindcss(),
  ],
}
