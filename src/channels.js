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
];

/** Known handle → channelId mapping for auto-migration */
export const KNOWN_CHANNEL_IDS = Object.fromEntries(
  DEFAULT_CHANNELS.map((ch) => [ch.handle, ch.channelId])
);

const COLORS = ['#e53935', '#d4a017', '#1e88e5', '#43a047', '#8e24aa', '#f4511e', '#00897b', '#5c6bc0'];

export function pickColor(index) {
  return COLORS[index % COLORS.length];
}
