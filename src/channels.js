/**
 * Default channels with verified YouTube Channel IDs.
 * channelId (UC...) is REQUIRED for iframe embedding to work.
 */
export const DEFAULT_CHANNELS = [
  {
    name: 'Al Jazeera',
    handle: '@aljazeera',
    channelId: 'UCfiwzLy-8yKzIbsmZTzxDgw',
    color: '#d4a017',
  },
  {
    name: 'Al Hadath',
    handle: '@AlHadath',
    channelId: 'UCrj5BGAhtWxDfqbza9T9hqA',
    color: '#1e88e5',
  },
  {
    name: 'Al Ekhbariah SY',
    handle: '@AlekhbariahSY',
    channelId: 'UClm30t2F4FHzzkN9Irtr-8A',
    color: '#43a047',
  },
  {
    name: 'Al Arabiya',
    handle: '@AlArabiya',
    channelId: 'UCahpxixMCwoANAftn6IxkTg',
    color: '#e53935',
  },
  {
    name: 'BBC News',
    handle: '@BBCNews',
    channelId: 'UC16niRr50-MSBwiO3YDb3RA',
    color: '#bb1919',
  },
  {
    name: 'CNN',
    handle: '@CNN',
    channelId: 'UCupvZG-5ko_eiXAupbDfxWw',
    color: '#cc0000',
  },
  {
    name: 'Fox News',
    handle: '@FoxNews',
    channelId: 'UCXIJgqnII2ZOINSWNOGFThA',
    color: '#003366',
  },
  {
    name: 'MSNBC',
    handle: '@MSNBC',
    channelId: 'UCaXkIU1QidjPwiAYu6GcHjg',
    color: '#0b5394',
  },
  {
    name: 'Sky News',
    handle: '@SkyNews',
    channelId: 'UCoMdktPbSTixAyNGwb-UYkQ',
    color: '#e31e26',
  },
  {
    name: 'ABC News',
    handle: '@ABCNews',
    channelId: 'UCBi2mrWuNuyYy4gbM6fU18Q',
    color: '#0066cc',
  },
  {
    name: 'CBS News',
    handle: '@CBSNews',
    channelId: 'UC8p1vwvWtl6T73JiExfWs1g',
    color: '#1a1a2e',
  },
  {
    name: 'NBC News',
    handle: '@NBCNews',
    channelId: 'UCeY0bbntWzzVIaj2z3QigXg',
    color: '#ff6600',
  },
  {
    name: 'France 24',
    handle: '@FRANCE24English',
    channelId: 'UCQfwfsi5VrQ8yKZ-UWmAEFg',
    color: '#0055a4',
  },
  {
    name: 'DW News',
    handle: '@DWNews',
    channelId: 'UCknLrEdhRCp1aegoMqRaCZg',
    color: '#00a0de',
  },
  {
    name: 'Reuters',
    handle: '@Reuters',
    channelId: 'UChqUTb7kYRX8-EiaN3XFrSQ',
    color: '#ff8000',
  },
];

/** Known handle → channelId mapping for auto-migration */
export const KNOWN_CHANNEL_IDS = Object.fromEntries(
  DEFAULT_CHANNELS.map((ch) => [ch.handle, ch.channelId])
);

const COLORS = ['#e53935', '#d4a017', '#1e88e5', '#43a047', '#8e24aa', '#f4511e', '#00897b', '#5c6bc0'];

export function pickColor(index) {
  return COLORS[index % COLORS.length];
}
