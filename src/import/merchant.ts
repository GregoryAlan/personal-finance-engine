// Prefix patterns stripped from the beginning of descriptions
const PREFIXES: [RegExp, string?][] = [
  [/^SQ \*/i],
  [/^SQC\*/i],
  [/^TST\*/i],
  [/^SP \*/i],
  [/^PP\*/i, "PayPal"],
  [/^PAYPAL \*/i, "PayPal"],
  [/^APL\*\s*/i, "Apple"],
  [/^APPLE\.COM\/BILL/i, "Apple"],
  [/^AMZN MKTP US\S*/i, "Amazon"],
  [/^AMZN\s+/i, "Amazon"],
  [/^AMAZON\.COM\S*/i, "Amazon"],
  [/^Amazon\.com\S*/i, "Amazon"],
  [/^AMAZON PRIME\S*/i, "Amazon Prime"],
  [/^Prime Video\S*/i, "Amazon Prime Video"],
  [/^CKE\*/i],
  [/^DD\s+/i],
  [/^DG\s+/i],
  [/^WM SUPERCENTER/i, "Walmart"],
  [/^WAL-MART/i, "Walmart"],
  [/^WALMART/i, "Walmart"],
  [/^POS DEBIT\s+/i],
  [/^POS PURCHASE\s+/i],
  [/^POS\s+/i],
  [/^DEBIT CARD PURCHASE\s+/i],
  [/^RECURRING PAYMENT\s+/i],
  [/^ONLINE PAYMENT\s+/i],
  [/^PURCHASE\s+/i],
  [/^CHECKCARD\s+\d*\s*/i],
  [/^CHK\s+/i],
  [/^ACH\s+(DEBIT|CREDIT)\s+/i],
  [/^VISA\s+/i],
  [/^MC\s+/i],
];

// Suffix patterns stripped from the end of descriptions
const SUFFIX_PATTERNS: RegExp[] = [
  // Store numbers: #1234, ##5678
  /\s+##+\d+/,
  /\s+#\d{2,}/,
  // Location: city + state (2-letter) + optional ZIP
  /\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+[A-Z]{2}\s*\d{0,5}\s*$/,
  // Just state code at end
  /\s+[A-Z]{2}\s*\d{5}(-\d{4})?\s*$/,
  // ZIP code alone
  /\s+\d{5}(-\d{4})?\s*$/,
  // Phone numbers
  /\s+\d{3}-\d{3}-\d{4}\s*$/,
  /\s+\d{10,11}\s*$/,
  // Reference/transaction numbers (long digit sequences)
  /\s+\d{6,}\s*$/,
  // Date patterns (MM/DD, MM/DD/YY)
  /\s+\d{2}\/\d{2}(\/\d{2,4})?\s*$/,
  // Trailing asterisks and IDs like *AB12CD34E
  /\s*\*[A-Z0-9]+\s*$/,
  // Common trailing tokens
  /\s+\d{2,4}$/,
];

// Alias table: longest prefix match wins, maps to canonical name
const MERCHANT_ALIASES: [string, string][] = [
  // Streaming & Subscriptions
  ["NETFLIX", "Netflix"],
  ["HULU", "Hulu"],
  ["SPOTIFY", "Spotify"],
  ["DISNEY PLUS", "Disney+"],
  ["DISNEYPLUS", "Disney+"],
  ["HBO MAX", "HBO Max"],
  ["YOUTUBE", "YouTube"],
  ["APPLE MUSIC", "Apple Music"],
  ["AUDIBLE", "Audible"],
  ["PARAMOUNT", "Paramount+"],
  ["PEACOCK", "Peacock"],
  ["CRUNCHYROLL", "Crunchyroll"],
  ["ADOBE", "Adobe"],
  ["DROPBOX", "Dropbox"],
  ["GOOGLE STORAGE", "Google Storage"],
  ["GOOGLE ONE", "Google One"],
  ["ICLOUD", "iCloud"],
  ["MICROSOFT", "Microsoft"],

  // Food & Delivery
  ["DOORDASH", "DoorDash"],
  ["UBER EATS", "Uber Eats"],
  ["GRUBHUB", "Grubhub"],
  ["INSTACART", "Instacart"],
  ["CHIPOTLE", "Chipotle"],
  ["STARBUCKS", "Starbucks"],
  ["DUNKIN", "Dunkin'"],
  ["CHICK-FIL-A", "Chick-fil-A"],
  ["CHICKFILA", "Chick-fil-A"],
  ["MCDONALD", "McDonald's"],
  ["SUBWAY", "Subway"],
  ["PANERA", "Panera Bread"],
  ["SWEETGREEN", "Sweetgreen"],
  ["PANDA EXPRESS", "Panda Express"],
  ["TACO BELL", "Taco Bell"],
  ["WENDY", "Wendy's"],
  ["BURGER KING", "Burger King"],
  ["FIVE GUYS", "Five Guys"],
  ["DOMINO", "Domino's"],
  ["PIZZA HUT", "Pizza Hut"],
  ["PAPA JOHN", "Papa John's"],

  // Grocery
  ["WHOLE FOODS", "Whole Foods"],
  ["TRADER JOE", "Trader Joe's"],
  ["SAFEWAY", "Safeway"],
  ["KROGER", "Kroger"],
  ["COSTCO", "Costco"],
  ["COSTCO WHSE", "Costco"],
  ["SAM'S CLUB", "Sam's Club"],
  ["SAMS CLUB", "Sam's Club"],
  ["TARGET", "Target"],
  ["ALDI", "Aldi"],
  ["PUBLIX", "Publix"],
  ["HEB ", "H-E-B"],
  ["WEGMANS", "Wegmans"],
  ["SPROUTS", "Sprouts"],
  ["HARRIS TEETER", "Harris Teeter"],

  // Retail
  ["AMAZON", "Amazon"],
  ["WALMART", "Walmart"],
  ["BEST BUY", "Best Buy"],
  ["HOME DEPOT", "Home Depot"],
  ["LOWES", "Lowe's"],
  ["LOWE'S", "Lowe's"],
  ["IKEA", "IKEA"],
  ["BED BATH", "Bed Bath & Beyond"],
  ["MARSHALLS", "Marshalls"],
  ["TJ MAXX", "TJ Maxx"],
  ["TJMAXX", "TJ Maxx"],
  ["ROSS STORES", "Ross"],
  ["NORDSTROM", "Nordstrom"],
  ["MACYS", "Macy's"],
  ["MACY'S", "Macy's"],
  ["OLD NAVY", "Old Navy"],
  ["GAP ", "Gap"],
  ["ZARA", "Zara"],
  ["H&M", "H&M"],
  ["NIKE", "Nike"],
  ["APPLE STORE", "Apple Store"],
  ["CVS", "CVS"],
  ["WALGREENS", "Walgreens"],
  ["RITE AID", "Rite Aid"],

  // Transportation
  ["UBER ", "Uber"],
  ["UBER TRIP", "Uber"],
  ["LYFT", "Lyft"],
  ["SHELL", "Shell"],
  ["CHEVRON", "Chevron"],
  ["EXXON", "Exxon"],
  ["BP ", "BP"],
  ["SUNOCO", "Sunoco"],
  ["WAWA", "Wawa"],
  ["SHEETZ", "Sheetz"],

  // Utilities & Services
  ["COMCAST", "Comcast"],
  ["XFINITY", "Xfinity"],
  ["AT&T", "AT&T"],
  ["ATT ", "AT&T"],
  ["VERIZON", "Verizon"],
  ["T-MOBILE", "T-Mobile"],
  ["TMOBILE", "T-Mobile"],
  ["SPECTRUM", "Spectrum"],
  ["CON EDISON", "Con Edison"],
  ["PG&E", "PG&E"],

  // Finance & Payments
  ["VENMO", "Venmo"],
  ["ZELLE", "Zelle"],
  ["CASH APP", "Cash App"],
  ["PAYPAL", "PayPal"],
  ["COINBASE", "Coinbase"],
  ["ROBINHOOD", "Robinhood"],

  // Fitness
  ["PLANET FITNESS", "Planet Fitness"],
  ["EQUINOX", "Equinox"],
  ["ORANGETHEORY", "Orangetheory"],
  ["PELOTON", "Peloton"],

  // Travel
  ["AIRBNB", "Airbnb"],
  ["VRBO", "VRBO"],
  ["UNITED AIR", "United Airlines"],
  ["DELTA AIR", "Delta Airlines"],
  ["AMERICAN AIR", "American Airlines"],
  ["SOUTHWEST AIR", "Southwest Airlines"],
  ["JETBLUE", "JetBlue"],
  ["MARRIOTT", "Marriott"],
  ["HILTON", "Hilton"],
  ["HYATT", "Hyatt"],

  // Special patterns
  ["CHECK ", "Check"],
  ["CHECK#", "Check"],
  ["ATM WITHDRAWAL", "ATM Withdrawal"],
  ["ATM ", "ATM"],
  ["INTEREST CHARGE", "Interest Charge"],
  ["INTEREST PAYMENT", "Interest Payment"],
  ["LATE FEE", "Late Fee"],
  ["ANNUAL FEE", "Annual Fee"],
  ["OVERDRAFT", "Overdraft Fee"],
].sort((a, b) => b[0].length - a[0].length) as [string, string][]; // Sort by length descending for longest-prefix-first

function titleCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/(?:^|\s|[-/])\w/g, (match) => match.toUpperCase())
    .trim();
}

export function extractMerchant(rawDescription: string): string {
  let desc = rawDescription.trim();
  if (!desc) return desc;

  // Step 1: Strip known prefixes
  let prefixAlias: string | undefined;
  for (const [pattern, alias] of PREFIXES) {
    const match = desc.match(pattern);
    if (match) {
      if (alias && desc.length - match[0].length < 3) {
        // The prefix IS the description essentially, use alias
        return alias;
      }
      prefixAlias = alias;
      desc = desc.slice(match[0].length).trim();
      break;
    }
  }

  // Step 2: Check alias table (longest prefix match)
  const upperDesc = desc.toUpperCase();
  for (const [pattern, canonical] of MERCHANT_ALIASES) {
    if (upperDesc.startsWith(pattern)) {
      return canonical;
    }
  }

  // If a prefix gave us an alias and nothing else matched, use it
  if (prefixAlias) {
    // Still strip suffixes from remaining desc
    for (const suffix of SUFFIX_PATTERNS) {
      desc = desc.replace(suffix, "");
    }
    if (desc.length < 2) return prefixAlias;
    return titleCase(desc);
  }

  // Step 3: Strip trailing suffixes
  let prevDesc: string;
  do {
    prevDesc = desc;
    for (const suffix of SUFFIX_PATTERNS) {
      desc = desc.replace(suffix, "");
    }
    desc = desc.trim();
  } while (desc !== prevDesc && desc.length > 0);

  if (desc.length < 2) return titleCase(rawDescription.trim().split(/\s+/)[0]);

  // Step 4: Title case the result
  return titleCase(desc);
}
