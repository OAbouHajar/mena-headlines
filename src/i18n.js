// ============ Internationalisation (EN / AR) ============

const STORAGE_KEY = 'ytmv_lang';

const translations = {
  en: {
    // Header
    appTitle: 'Middle East Live',
    addChannel: 'Add Channel',
    theatreTitle: 'Theatre Mode (T)',
    refreshTitle: 'Refresh All (R)',
    toggleSidebar: 'Toggle Sidebar (S)',
    // Sidebar
    channels: 'Channels',
    resetTitle: 'Reset to defaults',
    quickAddPlaceholder: 'Paste YouTube link, e.g. youtube.com/@CNN',
    // Modal
    addNewChannel: 'Add New Channel',
    editChannel: 'Edit Channel',
    channelName: 'Channel Name',
    channelNamePlaceholder: 'e.g. Al Jazeera',
    youtubeHandle: 'YouTube Handle',
    handlePlaceholder: '@aljazeera',
    channelIdLabel: 'Channel ID',
    channelIdRequired: '(required for embed)',
    channelIdPlaceholder: 'UCfiwzLy-8yKzIbsmZTzxDgw',
    channelIdHint: 'Starts with UC — find it in page source under "externalId" or "browse_id"',
    handleHint: 'Used for linking to the channel page',
    cancel: 'Cancel',
    saveChannel: 'Save Channel',
    // Grid
    emptyState: 'Select channels from the sidebar to begin watching',
    noChannelId: 'No Channel ID set — click Edit to add it',
    editChannelBtn: 'Edit Channel',
    openYT: 'Open on YouTube',
    fullscreen: 'Fullscreen',
    reload: 'Reload',
    // Toasts
    toastAdded: (n) => `Added ${n}`,
    toastAddedWarn: (n) => `Added ${n} — edit to add Channel ID`,
    toastUpdated: (n) => `Updated ${n}`,
    toastRemoved: (n) => `Removed ${n}`,
    toastRefreshed: 'Refreshed all streams',
    toastReset: 'Reset to defaults',
    toastNameRequired: 'Channel name is required',
    resetConfirm: 'Reset all channels to defaults? Custom channels will be removed.',
    // Layout
    liveCount: (n) => `${n} Live`,
    // Auth
    signIn: 'Sign In',
    signOut: 'Sign Out',
    signInWithGoogle: 'Sign in with Google',
    welcomeBack: (name) => `Welcome, ${name}`,
    signedOut: 'Signed out',
    cloudSync: 'Synced to cloud',
    contributors: 'Contributors',
    projectContributors: 'Project Contributors',
    nContributions: (n) => `${n} contributions`,
    contributorLoadError: 'Failed to load contributors',
    firebaseNotConfigured: 'Firebase not configured — see .env file',
    // Lang toggle
    langLabel: 'عربي',
    // Sidebar updates tab
    updates: 'Updates',
    updatesEmpty: 'Headlines will appear here as the ticker loads.',
    // Intelligence Panel
    intelBtn: 'AI Intelligence',
    intelPanelTitle: 'Live Intelligence Summary',
    intelAnalyzing: 'Analyzing…',
    intelRefreshTitle: 'Refresh analysis',
    intelCloseTitle: 'Close (Esc)',
    intelSituationOverview: 'Situation Overview',
    intelWhyItMatters: 'Why It Matters',
    intelKeyDynamics: 'Key Dynamics',
    intelConfidence: 'Confidence',
    intelRiskLevel: 'Risk Level',
    intelOutlook: 'Short-Term Outlook',
    intelMarketData: 'Live Market & Airspace',
    intelMarketPulse: 'Market & Geopolitical Link',
    intelFlightsActive: 'active flights in region',
    intelUpdatedNow: 'Updated just now',
    intelUpdatedSecs: (s) => `Updated ${s}s ago`,
    intelUpdatedMins: (m) => `Updated ${m}m ago`,
    intelErrorMsg: 'Analysis unavailable. Will retry on next refresh.',
    intelEmptyMsg: 'Click refresh or wait for analysis to load.',
    intelRiskLow: 'Low',
    intelRiskModerate: 'Moderate',
    intelRiskElevated: 'Elevated',
    intelRiskHigh: 'High',
    intelConfLow: 'Low',
    intelConfModerate: 'Moderate',
    intelConfHigh: 'High',
    intelHeaderLoading: 'Analyzing latest news with AI…',
    intelNow: 'Now',
    intelHoursAgo: (h) => `${h}h ago`,
    intelOlderTitle: 'Older report',
    intelNewerTitle: 'Newer report',
    // Stats Panel
    statsBtn: 'Stats',
    // Flight Panel
    flightBtn: 'Air Radar',
    flightPanel: 'Air Radar ✈️',
    stats: 'Stats',
    statsMarket: 'Market Pulse',
    statsOil: 'WTI Oil',
    statsGold: 'Gold',
    statsBrent: 'Brent',
    statsNatGas: 'Nat Gas',
    statsAlerts: 'Armed Conflict News',
    statsConflicts: 'Active Conflicts',
    statsFatalities: 'Fatalities (30d)',
    statsEvents: 'Events (30d)',
    statsLoading: 'Loading data…',
    statsNoData: 'Data unavailable',
    statsAlertGreen: 'Monitor',
    statsAlertOrange: 'Escalating',
    statsAlertRed: 'Critical',
    statsAcledNote: 'Conflict data requires ACLED API key',
    // Tension card
    tensionTitle: 'Conflict Escalation Index',
    tensionLow: 'Low Activity',
    tensionModerate: 'Moderate',
    tensionElevated: 'Elevated',
    tensionCritical: 'Critical',
    tensionNote: 'Based on global armed conflict news. Indicative only.',
    // Modal resolve
    youtubeUrl: 'YouTube URL',
    resolve: 'Resolve',
    resolveHint: 'Paste a channel link — name, handle, ID & logo will be filled automatically',
    resolveSuccess: 'Channel info resolved!',
    resolveErrorId: 'Could not resolve Channel ID — check the URL',
    resolveError: 'Failed to fetch channel info',
    resolving: '…',
    // Grid
    setStreamId: 'Set stream ID',
    liveTag: 'Live',
    // Flight panel
    flightActiveLabel: 'active flights in region',
    flightByCountry: 'Airspace by Country',
    flightLastUpdate: 'Last update',
    flightActiveCount: 'active flight in region',
    flightLoadError: 'Failed to connect to OpenSky',
    flightDataError: 'Failed to load flight data',
    // Ticker / Updates
    officialStatements: 'Official Statements',
    loadingFeeds: 'Loading official feeds…',
    latestNews: 'Latest News',
    justNow: 'just now',
    minutesAgo: (m) => `${m}m ago`,
    hoursAgo: (h) => `${h}h ago`,
    // Stats
    topStocks: 'Top 10 Stocks',
    // Chat
    chat: 'Chat',
    chatSubtitle: '🤖 3 AI analysts share insights every 2 hours',
    chatPlaceholder: 'Type a message…',
    chatSend: 'Send',
    chatUsername: 'Choose a display name',
    chatUsernamePlaceholder: 'Your name',
    chatUsernameSet: 'Set',
    chatEmpty: 'No messages yet. Start the conversation!',
    chatReply: 'Reply',
    chatReplyingTo: (name) => `Replying to ${name}`,
    chatJustNow: 'just now',
    chatMinutesAgo: (m) => `${m}m ago`,
    chatHoursAgo: (h) => `${h}h ago`,
    chatDaysAgo: (d) => `${d}d ago`,
    chatMessageTooLong: 'Message is too long (max 500 chars)',
    chatNameRequired: 'Please set a display name first',
    chatAnonymous: 'Anonymous',
  },
  ar: {
    appTitle: 'Middle East Live',
    addChannel: 'إضافة قناة',
    theatreTitle: 'وضع المسرح (T)',
    refreshTitle: 'تحديث الكل (R)',
    toggleSidebar: 'تبديل الشريط الجانبي (S)',
    channels: 'القنوات',
    resetTitle: 'إعادة تعيين للافتراضي',
    quickAddPlaceholder: 'الصق رابط يوتيوب، مثال: youtube.com/@CNN',
    addNewChannel: 'إضافة قناة جديدة',
    editChannel: 'تعديل القناة',
    channelName: 'اسم القناة',
    channelNamePlaceholder: 'مثال: الجزيرة',
    youtubeHandle: 'معرف يوتيوب',
    handlePlaceholder: '@aljazeera',
    channelIdLabel: 'معرّف القناة',
    channelIdRequired: '(مطلوب للتضمين)',
    channelIdPlaceholder: 'UCfiwzLy-8yKzIbsmZTzxDgw',
    channelIdHint: 'يبدأ بـ UC — ابحث عنه في مصدر الصفحة تحت "externalId" أو "browse_id"',
    handleHint: 'يستخدم للربط بصفحة القناة',
    cancel: 'إلغاء',
    saveChannel: 'حفظ القناة',
    emptyState: 'اختر القنوات من الشريط الجانبي لبدء المشاهدة',
    noChannelId: 'لا يوجد معرّف قناة — انقر على تعديل لإضافته',
    editChannelBtn: 'تعديل القناة',
    openYT: 'فتح على يوتيوب',
    fullscreen: 'ملء الشاشة',
    reload: 'إعادة تحميل',
    toastAdded: (n) => `تمت إضافة ${n}`,
    toastAddedWarn: (n) => `تمت إضافة ${n} — عدّل لإضافة معرّف القناة`,
    toastUpdated: (n) => `تم تحديث ${n}`,
    toastRemoved: (n) => `تمت إزالة ${n}`,
    toastRefreshed: 'تم تحديث جميع البثوث',
    toastReset: 'تمت إعادة التعيين للافتراضي',
    toastNameRequired: 'اسم القناة مطلوب',
    resetConfirm: 'إعادة تعيين جميع القنوات للافتراضي؟ ستتم إزالة القنوات المخصصة.',
    streamLabel: (n) => `${n} بث`,
    liveCount: (n) => `${n} بث مباشر`,
    signIn: 'تسجيل الدخول',
    signOut: 'تسجيل الخروج',
    signInWithGoogle: 'تسجيل الدخول بحساب جوجل',
    welcomeBack: (name) => `مرحباً، ${name}`,
    signedOut: 'تم تسجيل الخروج',
    cloudSync: 'تمت المزامنة مع السحابة',
    contributors: 'المساهمون',
    projectContributors: 'المساهمون في المشروع',
    nContributions: (n) => `${n} مساهمة`,
    contributorLoadError: 'فشل تحميل المساهمين',
    firebaseNotConfigured: 'لم يتم إعداد Firebase — راجع ملف .env',
    langLabel: 'EN',
    // Sidebar updates tab
    updates: 'آخر الأخبار',
    updatesEmpty: 'ستظهر العناوين هنا عند تحميل الشريط.',
    // Intelligence Panel
    intelBtn: 'تحليل الذكاء الاصطناعي',
    intelPanelTitle: 'ملخص الاستخبارات المباشرة',
    intelAnalyzing: 'جارٍ التحليل…',
    intelRefreshTitle: 'تحديث التحليل',
    intelCloseTitle: 'إغلاق (Esc)',
    intelSituationOverview: 'نظرة عامة على الوضع',
    intelWhyItMatters: 'شو المهم',
    intelKeyDynamics: 'الديناميات الرئيسية',
    intelConfidence: 'مستوى الثقة',
    intelRiskLevel: 'مستوى المخاطر',
    intelOutlook: 'التوقعات قصيرة المدى',
    intelMarketData: 'السوق والمجال الجوي لحظياً',
    intelMarketPulse: 'ربط السوق بالجيوسياسة',
    intelFlightsActive: 'رحلة نشطة في المنطقة',
    intelUpdatedNow: 'تم التحديث للتو',
    intelUpdatedSecs: (s) => `تم التحديث منذ ${s}ث`,
    intelUpdatedMins: (m) => `تم التحديث منذ ${m}د`,
    intelErrorMsg: 'التحليل غير متاح. سيُعاد المحاولة عند التحديث.',
    intelEmptyMsg: 'انقر على تحديث أو انتظر تحميل التحليل.',
    intelRiskLow: 'منخفض',
    intelRiskModerate: 'متوسط',
    intelRiskElevated: 'مرتفع',
    intelRiskHigh: 'خطر',
    intelConfLow: 'منخفضة',
    intelConfModerate: 'متوسطة',
    intelConfHigh: 'عالية',
    intelHeaderLoading: 'جاري تحليل الاخبار باستخدام الذكاء الاصطناعي',
    intelNow: 'الآن',
    intelHoursAgo: (h) => `منذ ${h}س`,
    intelOlderTitle: 'تقرير أقدم',
    intelNewerTitle: 'تقرير أحدث',
    // Stats Panel
    statsBtn: 'إحصاءات',
    // Flight Panel
    flightBtn: 'حالة الطيران',
    flightPanel: 'حالة الطيران ✈️',
    stats: 'إحصاءات',
    statsMarket: 'نبض الأسواق',
    statsOil: 'نفط WTI',
    statsGold: 'الذهب',
    statsBrent: 'برنت',
    statsNatGas: 'غاز طبيعي',
    statsAlerts: 'أخبار النزاعات المسلحة',
    statsConflicts: 'النزاعات النشطة',
    statsFatalities: 'الوفيات (30 يوم)',
    statsEvents: 'الأحداث (30 يوم)',
    statsLoading: 'جارِ تحميل البيانات…',
    statsNoData: 'البيانات غير متاحة',
    statsAlertGreen: 'مراقبة',
    statsAlertOrange: 'تصعيد',
    statsAlertRed: 'حرجة',
    statsAcledNote: 'بيانات النزاعات تتطلب مفتاح ACLED API',
    // Tension card
    tensionTitle: 'مؤشر التصعيد العسكري',
    tensionLow: 'نشاط منخفض',
    tensionModerate: 'متوسط',
    tensionElevated: 'مرتفع',
    tensionCritical: 'حرج',
    tensionNote: 'مبني على أخبار النزاعات المسلحة العالمية. مؤشر استرشادي.',
    // Modal resolve
    youtubeUrl: 'رابط يوتيوب',
    resolve: 'بحث',
    resolveHint: 'الصق رابط القناة — سيتم ملء الاسم والمعرف والشعار تلقائياً',
    resolveSuccess: 'تم حل معلومات القناة!',
    resolveErrorId: 'تعذّر حل معرّف القناة — تحقق من الرابط',
    resolveError: 'فشل في جلب معلومات القناة',
    resolving: '…',
    // Grid
    setStreamId: 'تعيين معرّف البث',
    liveTag: 'مباشر',
    // Flight panel
    flightActiveLabel: 'رحلة نشطة في المنطقة',
    flightByCountry: 'الأجواء حسب الدولة',
    flightLastUpdate: 'آخر تحديث',
    flightActiveCount: 'رحلة نشطة في المنطقة',
    flightLoadError: 'تعذّر الاتصال بـ OpenSky',
    flightDataError: 'تعذّر تحميل بيانات الرحلات',
    // Ticker / Updates
    officialStatements: 'بيانات رسمية',
    loadingFeeds: 'جاري تحميل البيانات الرسمية…',
    latestNews: 'آخر الأخبار',
    justNow: 'الآن',
    minutesAgo: (m) => `${m}د`,
    hoursAgo: (h) => `${h}س`,
    // Stats
    topStocks: 'أفضل 10 أسهم',
    // Chat
    chat: 'ساحة الحوار',
    chatSubtitle: '🤖 ٣ محللين AI يشاركون تحليلاتهم كل ساعتين',
    chatPlaceholder: 'اكتب رسالة…',
    chatSend: 'إرسال',
    chatUsername: 'اختر اسم العرض',
    chatUsernamePlaceholder: 'اسمك للمشاركة في الحوار',
    chatUsernameSet: 'حفظ',
    chatEmpty: 'لا توجد رسائل بعد. ابدأ المحادثة!',
    chatReply: 'رد',
    chatReplyingTo: (name) => `رد على ${name}`,
    chatJustNow: 'الآن',
    chatMinutesAgo: (m) => `${m}د`,
    chatHoursAgo: (h) => `${h}س`,
    chatDaysAgo: (d) => `${d}ي`,
    chatMessageTooLong: 'الرسالة طويلة جداً (الحد الأقصى 500 حرف)',
    chatNameRequired: 'يرجى تعيين اسم العرض أولاً',
    chatAnonymous: 'مجهول',
  },
};

let currentLang = localStorage.getItem(STORAGE_KEY) || 'ar';
const listeners = [];

/** Get a translation value by key */
export function t(key, ...args) {
  const val = translations[currentLang]?.[key] ?? translations.en[key] ?? key;
  return typeof val === 'function' ? val(...args) : val;
}

/** Current language code ('en' | 'ar') */
export function lang() {
  return currentLang;
}

/** Is the current language RTL? */
export function isRTL() {
  return currentLang === 'ar';
}

/** Toggle between EN and AR */
export function toggleLang() {
  currentLang = currentLang === 'en' ? 'ar' : 'en';
  localStorage.setItem(STORAGE_KEY, currentLang);
  applyDir();
  listeners.forEach((fn) => fn(currentLang));
}

/** Subscribe to language changes */
export function onLangChange(fn) {
  listeners.push(fn);
}

/** Apply dir/lang attributes to <html> */
export function applyDir() {
  const html = document.documentElement;
  html.setAttribute('dir', isRTL() ? 'rtl' : 'ltr');
  html.setAttribute('lang', currentLang);
}

// Apply on load
applyDir();
