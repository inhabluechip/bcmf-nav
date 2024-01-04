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

const htmlPlugin = () => {
  return {
    name: 'html-transform',
    async transformIndexHtml(html) {
      console.log(path.join(__dirname, 'pdf.csv'));
      const csv = readFileSync(path.join(__dirname, 'pdf.csv')).toString();
      const rows = csv.split('\n');

      const prices = await Promise.all(rows.slice(0, -1).map(e => fetchPrice(e.split(',')[0])));
      prices.push(1);

      const aum = rows.map((row, index) => row.split(',')[2] * prices[index]).reduce((acc, val) => acc + val);

      const AUM = aum.toLocaleString();
      const PDF = rows.map((row, index) => {
          const items = row.split(',');
          const asset_value = items[2] * prices[index];
          const weight = asset_value / aum * 100;
          return [
            weight,
            `<tr>
              <td class="p-1 text-center">${items[0]}</td>
              <td class="p-1 text-center">${items[1]}</td>
              <td class="p-1 text-center">${items[2]}</td>
              <td class="p-1 text-center">${asset_value.toLocaleString()}</td>
              <td class="p-1 text-center">${weight.toFixed(2)}</td>
            </tr>`
          ];
        })
        .toSorted((a, b) => (a[1].search('원화예금') *a[0]) - (b[1].search('원화예금') * b[0]))
        .map(e => e[1])
        .join('');
      return html.replace('__AUM__', AUM).replace('__PDF__', PDF);
    },
  };
};

export default {
  plugins: [
    htmlPlugin(),
  ],
}
