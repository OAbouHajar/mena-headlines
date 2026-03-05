import { lang, onLangChange } from './i18n.js';

// Group metadata for the X/tweets section
const TWEET_GROUPS = [
  { id: 'us',     label: '🇺🇸 US Gov',   css: 'west'   },
  { id: 'israel', label: '🇮🇱 Israel',   css: 'israel' },
  { id: 'iran',   label: '🇮🇷 Iran',     css: 'iran'   },
];

export class NewsTicker {
    constructor() {
        this._tweetsData    = [];   // Array of { handle, label, flag, group, items }
        this._tweetsLoading = false;
        this._tickerItems   = [];
        this.feedsByLang = {
            ar: [
                { id: 'aljazeera_arabic', name: 'الجزيرة', url: 'https://www.aljazeera.net/aljazeerarss/a7c186be-1baa-4bd4-9d80-a84db769f779/73d0e1b4-532f-45ef-b135-bfdff8b8cab9' },
                { id: 'skynews_arabia', name: 'سكاي نيوز', url: 'https://www.skynewsarabia.com/rss/breaking-news' },
                { id: 'alarabiya', name: 'العربية', url: 'https://www.alarabiya.net/feed/last-page' }
            ],
            en: [
                { id: 'aljazeera_english', name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
                { id: 'bbc_world', name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
                { id: 'skynews_world', name: 'Sky News', url: 'https://feeds.skynews.com/feeds/rss/world.rss' }
            ]
        };
        this.track = document.getElementById('tickerTrack');
        this.updateInterval = 120000; // 2 minutes
        this.init();
    }

    get feeds() {
        return this.feedsByLang[lang()] || this.feedsByLang.en;
    }

    get breakingLabel() {
        return lang() === 'ar' ? 'عاجل' : 'Breaking';
    }

    async init() {
        if (!this.track) return;
        // Show loading skeleton immediately while fetching
        this._tweetsLoading = true;
        this.renderUpdatesFeed([]);
        // Fetch in parallel
        await Promise.all([
            this.fetchAndDisplayNews(),
            this.fetchTweets(),
        ]);
        setInterval(() => this.fetchAndDisplayNews(), this.updateInterval);
        setInterval(() => this.fetchTweets(), 3 * 60 * 1000); // every 3 min
        this.setupInteractions();
        onLangChange(() => this.fetchAndDisplayNews());
    }

    /** Fetch tweets from the server-side /api/tweets endpoint */
    async fetchTweets() {
        this._tweetsLoading = true;
        this.renderUpdatesFeed(this._tickerItems);
        try {
            const resp = await fetch('/api/tweets', { signal: AbortSignal.timeout(20000) });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            this._tweetsData = await resp.json();
        } catch (err) {
            console.warn('[ticker] fetchTweets failed:', err.message);
            this._tweetsData = [];
        } finally {
            this._tweetsLoading = false;
            this.renderUpdatesFeed(this._tickerItems);
        }
    }

    async fetchAndDisplayNews() {
        try {
            let allNews = [];
            for (const feed of this.feeds) {
                const url = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed.url)}`;
                const response = await fetch(url);
                const data = await response.json();
                if (data.status === 'ok') {
                    const items = data.items.slice(0, 10).map(item => ({
                        title: this.cleanTitle(item.title),
                        source: feed.name,
                        channelId: feed.id,
                        pubDate: new Date(item.pubDate).getTime()
                    }));
                    allNews = allNews.concat(items);
                }
            }

            // Sort by latest, deduplicate by title using Set, take top 20
            allNews.sort((a, b) => b.pubDate - a.pubDate);
            const seen = new Set();
            const uniqueNews = allNews.filter(item => {
                if (seen.has(item.title)) return false;
                seen.add(item.title);
                return true;
            }).slice(0, 20);

            this.renderTicker(uniqueNews);
        } catch (error) {
            console.error('Error fetching news:', error);
        }
    }

    cleanTitle(title) {
        let clean = title.trim();
        if (clean.length > 120) {
            clean = clean.substring(0, 117) + '...';
        }
        return clean;
    }

    renderTicker(newsItems) {
        if (!this.track) return;

        let html = '';
        newsItems.forEach(item => {
            const mappedChannel = this.mapHeadline(item.title, item.channelId);
            html += `
                <div class="ticker-item" data-channel="${mappedChannel}" tabindex="0">
                    <span class="ticker-badge breaking">${this.breakingLabel}</span>
                    <span class="ticker-time">${this.timeAgo(item.pubDate)}</span>
                    <span class="ticker-text">${item.title}</span>
                    <span class="ticker-source">${item.source}</span>
                </div>
            `;
        });

        // Duplicate for seamless scroll
        this.track.innerHTML = html + html;

        // Sync to updates feed panel
        this.renderUpdatesFeed(newsItems);
    }

    renderUpdatesFeed(newsItems) {
        this._tickerItems = newsItems;
        const feed = document.getElementById('updatesFeed');
        if (!feed) return;
        const empty = document.getElementById('updatesEmpty');
        if (empty) empty.remove();

        // ── Section 1: X / Tweets ───────────────────────────────────────────
        let tweetsHTML = '';
        if (this._tweetsLoading && this._tweetsData.length === 0) {
            // Skeleton while loading
            tweetsHTML = `
                <div class="news-perspective-block">
                    <div class="news-perspective-header">🗣️ Official Statements</div>
                    ${[1, 2, 3].map(() => `
                        <div class="news-source-group">
                            <div class="news-src-skeleton-label"></div>
                            <div class="news-src-skeleton-item"></div>
                            <div class="news-src-skeleton-item short"></div>
                        </div>`).join('')}
                </div>`;
        } else if (this._tweetsData.length > 0) {
            // Group accounts by country group
            const grouped = {};
            for (const acc of this._tweetsData) {
                if (!grouped[acc.group]) grouped[acc.group] = [];
                grouped[acc.group].push(acc);
            }
            tweetsHTML = `
                <div class="news-perspective-block">
                    <div class="news-perspective-header">🗣️ Official Statements</div>
                    ${TWEET_GROUPS.map(g => {
                        const accs = grouped[g.id] || [];
                        if (!accs.length) return '';
                        return `
                        <div class="news-tweet-group">
                            <div class="news-tweet-group-label news-src-${g.css}">${g.label}</div>
                            ${accs.map(acc => `
                                <div class="news-source-group">
                                    <a class="news-source-label news-src-${g.css} news-src-x" href="https://x.com/${acc.handle}" target="_blank" rel="noopener" title="View @${acc.handle} on X">
                                        <span class="news-src-flag">${acc.flag}</span>
                                        <span>@${acc.handle}</span>
                                        <span class="news-src-name-sub">${acc.label}</span>
                                    </a>
                                    ${acc.items.map(it => `
                                        <a class="news-item-link" href="${it.link || `https://x.com/${acc.handle}`}" target="_blank" rel="noopener">${it.title}</a>
                                    `).join('')}
                                </div>`).join('')}
                        </div>`;
                    }).join('')}
                </div>`;
        } else {
            tweetsHTML = `
                <div class="news-perspective-block">
                    <div class="news-perspective-header">🗣️ Official Statements</div>
                    <div class="news-unavail">Loading official feeds…</div>
                </div>`;
        }

        // ── Section 2: آخر الأخبار (RSS ticker items) ─────────────────────
        const rssHTML = newsItems.length ? `
            <div class="news-divider">📻 آخر الأخبار</div>
            ${newsItems.map(item => `
                <div class="update-item urgent">
                    <div class="update-headline">${item.title}</div>
                    <div class="update-meta">
                        <span class="update-source">${item.source}</span>
                        <span class="update-time">${this.timeAgo(item.pubDate)}</span>
                    </div>
                </div>`).join('')}` : '';

        feed.innerHTML = tweetsHTML + rssHTML;
    }

    timeAgo(ts) {
        const diff = Math.floor((Date.now() - ts) / 60000);
        if (diff < 1) return lang() === 'ar' ? 'الآن' : 'just now';
        if (diff < 60) return lang() === 'ar' ? `${diff}د` : `${diff}m ago`;
        const h = Math.floor(diff / 60);
        return lang() === 'ar' ? `${h}س` : `${h}h ago`;
    }

    mapHeadline(title, defaultSourceId) {
        const lowerTitle = title.toLowerCase();
        if (lowerTitle.includes('غزة') || lowerTitle.includes('فلسطين') || lowerTitle.includes('حماس')) return 'aljazeera_arabic';
        if (lowerTitle.includes('لبنان') || lowerTitle.includes('بيروت') || lowerTitle.includes('حزب الله')) return 'almayadeen';
        if (lowerTitle.includes('سعودية') || lowerTitle.includes('رياض')) return 'alarabiya';
        if (lowerTitle.includes('امريكا') || lowerTitle.includes('أمريكا') || lowerTitle.includes('واشنطن')) return 'skynews_arabia';
        
        // Map default sources to some known sidebar channel IDs
        if (defaultSourceId === 'aljazeera_arabic') return 'aljazeera';
        if (defaultSourceId === 'skynews_arabia') return 'skynews';
        if (defaultSourceId === 'alarabiya') return 'alarabiya';
        
        return defaultSourceId;
    }

    setupInteractions() {
        this.track.addEventListener('click', (e) => {
            const item = e.target.closest('.ticker-item');
            if (item) {
                const channelId = item.dataset.channel;
                if (channelId) {
                    this.activateChannel(channelId);
                }
            }
        });

        this.track.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const item = e.target.closest('.ticker-item');
                if (item) {
                    const channelId = item.dataset.channel;
                    if (channelId) {
                        this.activateChannel(channelId);
                    }
                }
            }
        });
    }

    activateChannel(channelId) {
        // Find channel in sidebar by fuzzy match or id
        const channelCards = document.querySelectorAll('.channel-card');
        let matchedCard = null;
        for (const card of channelCards) {
            const name = card.querySelector('.channel-name')?.textContent.toLowerCase() || '';
            const handle = card.querySelector('.channel-handle')?.textContent.toLowerCase() || '';
            if (name.includes(channelId.replace('_', ' ')) || handle.includes(channelId) || card.dataset.id === channelId) {
                matchedCard = card;
                break;
            }
        }

        if (matchedCard) {
            // Check if active
            const id = matchedCard.dataset.id;
            // Use existing functions from main by simulating a click on the card first if it's not active
            if (!matchedCard.classList.contains('active')) {
                matchedCard.click();
            }
            
            // Give time for DOM update
            setTimeout(() => {
                const videoCell = document.querySelector(`.video-cell[data-id="${id}"]`);
                if (videoCell) {
                    videoCell.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    // Highlight animation
                    videoCell.style.animation = 'none';
                    videoCell.offsetHeight; // trigger reflow
                    videoCell.style.animation = 'cellGlow 1s ease-out';
                }
            }, 100);
        } else {
            console.log('Ticker interaction: mapped channel not found in sidebar:', channelId);
        }
    }
}
