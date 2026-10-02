import type { LanguageCode } from '@sitebook/shared';

/**
 * The interface, in the language the person reads.
 *
 * A plain record rather than a library. The whole mechanism is a cookie, a context and a lookup —
 * no message formatting, no pluralisation engine, no build step. That is not a shortcut taken for
 * speed: `next-intl` and its relatives are route-segment frameworks, and bolting one onto an app
 * whose entire routing already exists would be a week of churn for a feature whose value is
 * "a supervisor can read the navigation".
 *
 * **What is translated, and what deliberately is not.**
 *
 * The site-facing surface is translated: the navigation, the headings and the forms somebody fills
 * in on a phone at the end of a day. The platform console is not, and will not be — it is used by
 * two people who built the thing, and a half-translated admin screen is worse than an English one.
 *
 * A missing key falls back to the English string, so an untranslated phrase reads as English rather
 * than as a key. That matters more than completeness: `nav.overview` on screen is a bug somebody
 * reports, while "Overview" in a Tamil interface is a sentence somebody understands.
 */

/** Every translatable string, keyed, with English as the source of truth. */
export const EN = {
  'nav.overview': 'Overview',
  'nav.sites': 'Sites',
  'nav.documents': 'Documents',
  'nav.labour': 'Labour',
  'nav.workers': 'Workers',
  'nav.attendance': 'Attendance',
  'nav.wagePeriods': 'Wage periods',
  'nav.finance': 'Finance',
  'nav.payments': 'Payments',
  'nav.expenses': 'Expenses',
  'nav.stock': 'Stock',
  'nav.operations': 'Operations',
  'nav.approvals': 'Approvals',
  'nav.reports': 'Reports',
  'nav.settings': 'Settings',
  'nav.signOut': 'Sign out',

  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.search': 'Search',
  'common.today': 'Today',
  'common.date': 'Date',
  'common.optional': 'Optional',
  'common.language': 'Language',
  'common.loading': 'Loading',

  'dpr.title': 'Daily report',
  'dpr.file': 'File a report',
  'dpr.filed': 'Report filed',
  'dpr.weather': 'Weather',
  'dpr.workDone': 'What got done today',
  'dpr.issues': 'Anything in the way',
  'dpr.issuesHint': 'Left blank if nothing is',
  'dpr.headcount': 'People on site',
  'dpr.photos': 'Photos',
  'dpr.addPhotos': 'Add photos',
  'dpr.speak': 'Speak the report',
  'dpr.speakHint': 'Rather say it? Two lines in Tamil, Hindi or English fills the form in.',
  'dpr.stop': 'Stop',
  'dpr.listening': 'Listening to it…',
  'dpr.whatWasSaid': 'What was said',
  'dpr.subtitle': 'What got done, who was on site, and what is in the way.',
  'dpr.photosHint': 'What the report is describing',
  'common.useThis': 'Use this',
  'common.translating': 'Translating',

  'documents.ask': 'Ask',
  'documents.asking': 'Reading',
  'documents.askHint':
    'Answered from the text of your own drawings and contracts, with the page it came from.',
} as const;

export type MessageKey = keyof typeof EN;

/**
 * Tamil.
 *
 * Written for a construction site rather than for a textbook: "வேலை" for work, "ஆட்கள்" for the
 * people on site, the words a supervisor in Hosur or Coimbatore would actually use out loud. Some
 * terms are deliberately left in English because that is what the trade says — "slab", "stock" —
 * and translating them into formal Tamil would make a sentence nobody uses.
 */
const TA: Partial<Record<MessageKey, string>> = {
  'nav.overview': 'முகப்பு',
  'nav.sites': 'தளங்கள்',
  'nav.documents': 'ஆவணங்கள்',
  'nav.labour': 'தொழிலாளர்',
  'nav.workers': 'ஆட்கள்',
  'nav.attendance': 'வருகை',
  'nav.wagePeriods': 'சம்பள காலம்',
  'nav.finance': 'நிதி',
  'nav.payments': 'பணப்பட்டுவாடா',
  'nav.expenses': 'செலவுகள்',
  'nav.stock': 'சரக்கு',
  'nav.operations': 'செயல்பாடுகள்',
  'nav.approvals': 'ஒப்புதல்கள்',
  'nav.reports': 'அறிக்கைகள்',
  'nav.settings': 'அமைப்புகள்',
  'nav.signOut': 'வெளியேறு',

  'common.cancel': 'ரத்து',
  'common.save': 'சேமி',
  'common.search': 'தேடு',
  'common.today': 'இன்று',
  'common.date': 'தேதி',
  'common.optional': 'விருப்பம்',
  'common.language': 'மொழி',
  'common.loading': 'ஏற்றுகிறது',

  'dpr.title': 'தினசரி அறிக்கை',
  'dpr.file': 'அறிக்கை பதிவு செய்',
  'dpr.filed': 'அறிக்கை பதிவு செய்யப்பட்டது',
  'dpr.weather': 'வானிலை',
  'dpr.workDone': 'இன்று என்ன வேலை முடிந்தது',
  'dpr.issues': 'ஏதாவது தடை இருக்கிறதா',
  'dpr.issuesHint': 'எதுவும் இல்லை என்றால் காலியாக விடுங்கள்',
  'dpr.headcount': 'தளத்தில் ஆட்கள்',
  'dpr.photos': 'புகைப்படங்கள்',
  'dpr.addPhotos': 'புகைப்படம் சேர்',
  'dpr.speak': 'அறிக்கையை சொல்லுங்கள்',
  'dpr.speakHint':
    'தட்டச்சு செய்ய வேண்டாமா? தமிழில் இரண்டு வரி சொன்னால் படிவம் நிரம்பும்.',
  'dpr.stop': 'நிறுத்து',
  'dpr.listening': 'கேட்டுக்கொண்டிருக்கிறது…',
  'dpr.whatWasSaid': 'சொன்னது',
  'dpr.subtitle': 'என்ன வேலை முடிந்தது, யார் தளத்தில் இருந்தார்கள், எது தடையாக இருக்கிறது.',
  'dpr.photosHint': 'அறிக்கை என்ன சொல்கிறதோ அது',
  'common.useThis': 'இதைப் பயன்படுத்து',
  'common.translating': 'மொழிபெயர்க்கிறது',

  'documents.ask': 'கேள்',
  'documents.asking': 'படிக்கிறது',
  'documents.askHint':
    'உங்கள் வரைபடங்கள் மற்றும் ஒப்பந்தங்களின் உரையிலிருந்து, எந்த பக்கம் என்பதுடன்.',
};

/**
 * The other four are not written yet, and say so by their absence.
 *
 * They fall back to English, which is exactly what happens today. Listing them in the language
 * picker with no strings behind them would be a lie told in a dropdown — so the picker offers only
 * what has been written, and this is the one place to add the next one.
 */
const DICTIONARIES: Partial<Record<LanguageCode, Partial<Record<MessageKey, string>>>> = {
  ta: TA,
};

/** Which languages the interface is actually available in. */
export const TRANSLATED_LANGUAGES: LanguageCode[] = ['en', ...(Object.keys(DICTIONARIES) as LanguageCode[])];

export function translate(language: LanguageCode, key: MessageKey): string {
  return DICTIONARIES[language]?.[key] ?? EN[key];
}

/** The cookie the choice lives in. Read on the server so the first paint is already right. */
export const LANGUAGE_COOKIE = 'buildr_lang';
