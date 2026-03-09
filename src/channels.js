
/**
 * Default channels with verified YouTube Channel IDs.
 * channelId (UC...) is REQUIRED for iframe embedding to work.
 */
/** Built-in group definitions */
export const GROUP_LABELS = {
  arabic: 'Arabic',
  us: 'US',
  iranian: 'Iranian',
  international: 'International',
};

/** Default group assignment by channelId for migration */
export const DEFAULT_GROUP_MAP = {};

export const DEFAULT_CHANNELS = [
  {
    name: 'Al Jazeera',
    handle: '@aljazeera',
    channelId: 'UCfiwzLy-8yKzIbsmZTzxDgw',
    color: '#d4a017',
    logo: '/logos/aljazeera.jpg',
    group: 'arabic',
  },
  {
    name: 'Al Hadath',
    handle: '@AlHadath',
    channelId: 'UCrj5BGAhtWxDfqbza9T9hqA',
    color: '#1e88e5',
    logo: '/logos/alhadath.jpg',
    group: 'arabic',
  },
  {
    name: 'Syria Television',
    handle: '@SyriaTelevision',
    channelId: 'UCJsZ22yL1IW0R2u0jnnyYog',
    color: '#2e7d32',
    logo: '/logos/syriatelevision.jpg',
    group: 'arabic',
  },
  {
    name: 'MTV Lebanon',
    handle: '@MTVLebanonNews',
    channelId: 'UC9_XmAwE5szLHF76FjMylaw',
    color: '#d32f2f',
    logo: '/logos/mtvlebanon.jpg',
    group: 'arabic',
  },
  {
    name: 'Al Jadeed',
    handle: '@AlJadeed',
    channelId: 'UCoAOpXaFG4v3J8b8TSLmXvg',
    color: '#1565c0',
    logo: '/logos/aljadeed.jpg',
    group: 'arabic',
  },
  {
    name: 'OTV Lebanon',
    handle: '@OTVLebanon',
    channelId: 'UCAEB5dW6UQmE3bR-_NN4LWQ',
    color: '#ff6f00',
    logo: '/logos/otvlebanon.jpg',
    group: 'arabic',
  },
  {
    name: 'NBN Lebanon',
    handle: '@NBNLebanon',
    channelId: 'UCCjufUB24LKK5GfmQ_2itgQ',
    color: '#6a1b9a',
    logo: '/logos/nbnlebanon.jpg',
    group: 'arabic',
  },
  {
    name: 'Iran International',
    handle: '@IranIntl',
    channelId: 'UCat6bC0Wrqq9Bcq7EkH_yQw',
    color: '#00695c',
    logo: '/logos/iranintl.jpg',
    group: 'iranian',
  },
  {
    name: 'BBC Persian',
    handle: '@BBCNewsPersian',
    channelId: 'UCHZk9MrT3DGWmVqdsj5y0EA',
    color: '#bb1919',
    logo: '/logos/bbcpersian.jpg',
    group: 'iranian',
  },
  {
    name: 'Manoto TV',
    handle: '@ManotoTV',
    channelId: 'UCnUdm0u-2FRffBnxQYHuTHA',
    color: '#f57c00',
    logo: '/logos/manototv.jpg',
    group: 'iranian',
  },
  {
    name: 'Press TV',
    handle: '@PressTV',
    channelId: 'UC0OO19kc2jt8ZtOWZMVa3Vw',
    color: '#2e7d32',
    logo: '/logos/presstv.jpg',
    group: 'iranian',
  },
  {
    name: 'Al Ekhbariah SY',
    handle: '@AlekhbariahSY',
    channelId: 'UClm30t2F4FHzzkN9Irtr-8A',
    color: '#43a047',
    logo: '/logos/alekhbariah.jpg',
    group: 'arabic',
  },
  {
    name: 'Al Arabiya',
    handle: '@AlArabiya',
    channelId: 'UCahpxixMCwoANAftn6IxkTg',
    color: '#e53935',
    logo: '/logos/alarabiya.jpg',
    group: 'arabic',
  },
  {
    name: 'BBC News',
    handle: '@BBCNews',
    channelId: 'UC16niRr50-MSBwiO3YDb3RA',
    color: '#bb1919',
    logo: '/logos/bbc.jpg',
    group: 'international',
  },
  {
    name: 'CNN',
    handle: '@CNN',
    channelId: 'UCupvZG-5ko_eiXAupbDfxWw',
    color: '#cc0000',
    logo: '/logos/cnn.jpg',
    group: 'us',
  },
  {
    name: 'Fox News',
    handle: '@FoxNews',
    channelId: 'UCXIJgqnII2ZOINSWNOGFThA',
    color: '#003366',
    logo: '/logos/foxnews.jpg',
    group: 'us',
  },
  {
    name: 'MSNBC',
    handle: '@MSNBC',
    channelId: 'UCaXkIU1QidjPwiAYu6GcHjg',
    color: '#0b5394',
    logo: '/logos/msnbc.jpg',
    group: 'us',
  },
  {
    name: 'Sky News',
    handle: '@SkyNews',
    channelId: 'UCoMdktPbSTixAyNGwb-UYkQ',
    color: '#e31e26',
    logo: '/logos/skynews.jpg',
    group: 'international',
  },
  {
    name: 'ABC News',
    handle: '@ABCNews',
    channelId: 'UCBi2mrWuNuyYy4gbM6fU18Q',
    color: '#0066cc',
    logo: '/logos/abcnews.jpg',
    group: 'us',
  },
  {
    name: 'CBS News',
    handle: '@CBSNews',
    channelId: 'UC8p1vwvWtl6T73JiExfWs1g',
    color: '#1a1a2e',
    logo: '/logos/cbsnews.jpg',
    group: 'us',
  },
  {
    name: 'NBC News',
    handle: '@NBCNews',
    channelId: 'UCeY0bbntWzzVIaj2z3QigXg',
    color: '#ff6600',
    logo: '/logos/nbcnews.jpg',
    group: 'us',
  },
  {
    name: 'France 24',
    handle: '@FRANCE24English',
    channelId: 'UCQfwfsi5VrQ8yKZ-UWmAEFg',
    color: '#0055a4',
    logo: '/logos/france24.jpg',
    group: 'international',
  },
  {
    name: 'DW News',
    handle: '@DWNews',
    channelId: 'UCknLrEdhRCp1aegoMqRaCZg',
    color: '#00a0de',
    logo: '/logos/dwnews.jpg',
    group: 'international',
  },
  {
    name: 'Reuters',
    handle: '@Reuters',
    channelId: 'UChqUTb7kYRX8-EiaN3XFrSQ',
    color: '#ff8000',
    logo: '/logos/reuters.jpg',
    group: 'international',
  },
  {
    name: 'Al Mayadeen',
    handle: '@almayadeentv',
    channelId: 'UCZCFHCU-2eGF7V5ciMkoPHw',
    color: '#b71c1c',
    logo: '/logos/almayadeen.jpg',
    group: 'arabic',
  },
];

// Build migration map
DEFAULT_CHANNELS.forEach((ch) => { DEFAULT_GROUP_MAP[ch.channelId] = ch.group; });

/** Known handle → channelId mapping for auto-migration */
export const KNOWN_CHANNEL_IDS = Object.fromEntries(
  DEFAULT_CHANNELS.map((ch) => [ch.handle, ch.channelId])
);

const COLORS = ['#e53935', '#d4a017', '#1e88e5', '#43a047', '#8e24aa', '#f4511e', '#00897b', '#5c6bc0'];
export function pickColor(index) {
  return COLORS[index % COLORS.length];
}
