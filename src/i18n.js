// ============ Internationalisation (EN / AR) ============

const STORAGE_KEY = 'ytmv_lang';

const translations = {
  en: {
    // Header
    appTitle: 'Live Intelligence Platform',
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
    intelUpdatedNow: 'Updated just now',
    intelUpdatedSecs: (s) => `Updated ${s}s ago`,
    intelUpdatedMins: (m) => `Updated ${m}m ago`,
    intelErrorMsg: 'Analysis unavailable. Will retry on next refresh.',
    intelEmptyMsg: 'Click refresh or wait for analysis to load.',
    intelRiskLow: 'Low',
    intelRiskModerate: 'Moderate',
    intelRiskElevated: 'Elevated',
    intelRiskHigh: 'High',
  },
  ar: {
    appTitle: 'منصة الاستخبارات المباشرة',
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
    intelWhyItMatters: 'لماذا يهمّ',
    intelKeyDynamics: 'الديناميات الرئيسية',
    intelConfidence: 'مستوى الثقة',
    intelRiskLevel: 'مستوى المخاطر',
    intelOutlook: 'التوقعات قصيرة المدى',
    intelUpdatedNow: 'تم التحديث للتو',
    intelUpdatedSecs: (s) => `تم التحديث منذ ${s}ث`,
    intelUpdatedMins: (m) => `تم التحديث منذ ${m}د`,
    intelErrorMsg: 'التحليل غير متاح. سيُعاد المحاولة عند التحديث.',
    intelEmptyMsg: 'انقر على تحديث أو انتظر تحميل التحليل.',
    intelRiskLow: 'منخفض',
    intelRiskModerate: 'متوسط',
    intelRiskElevated: 'مرتفع',
    intelRiskHigh: 'خطر',
  },
};

let currentLang = localStorage.getItem(STORAGE_KEY) || 'en';
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
