const axios = require('axios');

async function getCoins() {
  const url =
    'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&sparkline=false';

  const response = await axios.get(url);

  return response.data.map((coin) => ({
    id: coin.id,
    name: coin.name,
    symbol: coin.symbol,
    image: coin.image,
    price: coin.current_price,
    priceChange24h: coin.price_change_percentage_24h,
    marketCap: coin.market_cap,
  }));
}

module.exports = {
  getCoins,
};