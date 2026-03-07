export interface CategoryDef {
  name: string;
  parent?: string;
  type: "expense" | "income" | "transfer";
}

export const DEFAULT_CATEGORIES: CategoryDef[] = [
  // Income
  { name: "Income", type: "income" },
  { name: "Salary", parent: "Income", type: "income" },
  { name: "Bonus", parent: "Income", type: "income" },
  { name: "Interest", parent: "Income", type: "income" },
  { name: "Dividends", parent: "Income", type: "income" },
  { name: "Refunds", parent: "Income", type: "income" },
  { name: "Other Income", parent: "Income", type: "income" },

  // Housing
  { name: "Housing", type: "expense" },
  { name: "Rent", parent: "Housing", type: "expense" },
  { name: "Mortgage", parent: "Housing", type: "expense" },
  { name: "Property Tax", parent: "Housing", type: "expense" },
  { name: "Home Insurance", parent: "Housing", type: "expense" },
  { name: "Home Maintenance", parent: "Housing", type: "expense" },
  { name: "HOA", parent: "Housing", type: "expense" },

  // Utilities
  { name: "Utilities", type: "expense" },
  { name: "Electric", parent: "Utilities", type: "expense" },
  { name: "Gas", parent: "Utilities", type: "expense" },
  { name: "Water", parent: "Utilities", type: "expense" },
  { name: "Internet", parent: "Utilities", type: "expense" },
  { name: "Phone", parent: "Utilities", type: "expense" },

  // Food
  { name: "Food", type: "expense" },
  { name: "Groceries", parent: "Food", type: "expense" },
  { name: "Restaurants", parent: "Food", type: "expense" },
  { name: "Coffee", parent: "Food", type: "expense" },
  { name: "Delivery", parent: "Food", type: "expense" },

  // Transportation
  { name: "Transportation", type: "expense" },
  { name: "Gas & Fuel", parent: "Transportation", type: "expense" },
  { name: "Car Payment", parent: "Transportation", type: "expense" },
  { name: "Car Insurance", parent: "Transportation", type: "expense" },
  { name: "Parking", parent: "Transportation", type: "expense" },
  { name: "Public Transit", parent: "Transportation", type: "expense" },
  { name: "Rideshare", parent: "Transportation", type: "expense" },
  { name: "Car Maintenance", parent: "Transportation", type: "expense" },

  // Shopping
  { name: "Shopping", type: "expense" },
  { name: "Clothing", parent: "Shopping", type: "expense" },
  { name: "Electronics", parent: "Shopping", type: "expense" },
  { name: "Home Goods", parent: "Shopping", type: "expense" },
  { name: "Amazon", parent: "Shopping", type: "expense" },

  // Health
  { name: "Health", type: "expense" },
  { name: "Doctor", parent: "Health", type: "expense" },
  { name: "Pharmacy", parent: "Health", type: "expense" },
  { name: "Dental", parent: "Health", type: "expense" },
  { name: "Vision", parent: "Health", type: "expense" },
  { name: "Health Insurance", parent: "Health", type: "expense" },
  { name: "Gym", parent: "Health", type: "expense" },

  // Entertainment
  { name: "Entertainment", type: "expense" },
  { name: "Streaming", parent: "Entertainment", type: "expense" },
  { name: "Games", parent: "Entertainment", type: "expense" },
  { name: "Movies", parent: "Entertainment", type: "expense" },
  { name: "Music", parent: "Entertainment", type: "expense" },
  { name: "Books", parent: "Entertainment", type: "expense" },
  { name: "Hobbies", parent: "Entertainment", type: "expense" },

  // Subscriptions
  { name: "Subscriptions", type: "expense" },
  { name: "Software", parent: "Subscriptions", type: "expense" },
  { name: "News", parent: "Subscriptions", type: "expense" },
  { name: "Cloud Storage", parent: "Subscriptions", type: "expense" },

  // Travel
  { name: "Travel", type: "expense" },
  { name: "Flights", parent: "Travel", type: "expense" },
  { name: "Hotels", parent: "Travel", type: "expense" },
  { name: "Rental Cars", parent: "Travel", type: "expense" },

  // Personal
  { name: "Personal", type: "expense" },
  { name: "Haircut", parent: "Personal", type: "expense" },
  { name: "Gifts", parent: "Personal", type: "expense" },
  { name: "Donations", parent: "Personal", type: "expense" },
  { name: "Education", parent: "Personal", type: "expense" },
  { name: "Pet", parent: "Personal", type: "expense" },
  { name: "Childcare", parent: "Personal", type: "expense" },

  // Insurance
  { name: "Insurance", type: "expense" },
  { name: "Life Insurance", parent: "Insurance", type: "expense" },
  { name: "Umbrella Insurance", parent: "Insurance", type: "expense" },

  // Taxes
  { name: "Taxes", type: "expense" },
  { name: "Federal Tax", parent: "Taxes", type: "expense" },
  { name: "State Tax", parent: "Taxes", type: "expense" },
  { name: "FICA", parent: "Taxes", type: "expense" },

  // Fees
  { name: "Fees", type: "expense" },
  { name: "Bank Fees", parent: "Fees", type: "expense" },
  { name: "ATM Fees", parent: "Fees", type: "expense" },
  { name: "Late Fees", parent: "Fees", type: "expense" },

  // Transfers
  { name: "Transfer", type: "transfer" },
  { name: "Credit Card Payment", parent: "Transfer", type: "transfer" },
  { name: "Account Transfer", parent: "Transfer", type: "transfer" },
  { name: "Investment Contribution", parent: "Transfer", type: "transfer" },

  // Uncategorized
  { name: "Uncategorized", type: "expense" },
];

export const DEFAULT_RULES: { pattern: string; category: string }[] = [
  // Groceries
  { pattern: "WHOLE FOODS", category: "Food > Groceries" },
  { pattern: "TRADER JOE", category: "Food > Groceries" },
  { pattern: "KROGER", category: "Food > Groceries" },
  { pattern: "SAFEWAY", category: "Food > Groceries" },
  { pattern: "COSTCO", category: "Food > Groceries" },
  { pattern: "WALMART", category: "Food > Groceries" },
  { pattern: "TARGET", category: "Shopping" },
  { pattern: "ALDI", category: "Food > Groceries" },
  { pattern: "PUBLIX", category: "Food > Groceries" },
  { pattern: "H-E-B", category: "Food > Groceries" },
  { pattern: "SPROUTS", category: "Food > Groceries" },

  // Restaurants / Food
  { pattern: "DOORDASH", category: "Food > Delivery" },
  { pattern: "UBER EATS", category: "Food > Delivery" },
  { pattern: "GRUBHUB", category: "Food > Delivery" },
  { pattern: "STARBUCKS", category: "Food > Coffee" },
  { pattern: "DUNKIN", category: "Food > Coffee" },
  { pattern: "MCDONALD", category: "Food > Restaurants" },
  { pattern: "CHIPOTLE", category: "Food > Restaurants" },
  { pattern: "CHICK-FIL-A", category: "Food > Restaurants" },
  { pattern: "SUBWAY", category: "Food > Restaurants" },
  { pattern: "PANERA", category: "Food > Restaurants" },

  // Transportation
  { pattern: "UBER ", category: "Transportation > Rideshare" },
  { pattern: "LYFT", category: "Transportation > Rideshare" },
  { pattern: "SHELL ", category: "Transportation > Gas & Fuel" },
  { pattern: "CHEVRON", category: "Transportation > Gas & Fuel" },
  { pattern: "EXXON", category: "Transportation > Gas & Fuel" },
  { pattern: "BP ", category: "Transportation > Gas & Fuel" },
  { pattern: "GEICO", category: "Transportation > Car Insurance" },
  { pattern: "PROGRESSIVE", category: "Transportation > Car Insurance" },

  // Shopping
  { pattern: "AMAZON", category: "Shopping > Amazon" },
  { pattern: "AMZN", category: "Shopping > Amazon" },
  { pattern: "BEST BUY", category: "Shopping > Electronics" },
  { pattern: "APPLE.COM", category: "Shopping > Electronics" },
  { pattern: "IKEA", category: "Shopping > Home Goods" },

  // Entertainment / Streaming
  { pattern: "NETFLIX", category: "Entertainment > Streaming" },
  { pattern: "HULU", category: "Entertainment > Streaming" },
  { pattern: "SPOTIFY", category: "Entertainment > Music" },
  { pattern: "APPLE MUSIC", category: "Entertainment > Music" },
  { pattern: "DISNEY PLUS", category: "Entertainment > Streaming" },
  { pattern: "HBO MAX", category: "Entertainment > Streaming" },
  { pattern: "YOUTUBE PREMIUM", category: "Entertainment > Streaming" },
  { pattern: "AUDIBLE", category: "Entertainment > Books" },

  // Subscriptions
  { pattern: "GITHUB", category: "Subscriptions > Software" },
  { pattern: "DROPBOX", category: "Subscriptions > Cloud Storage" },
  { pattern: "GOOGLE STORAGE", category: "Subscriptions > Cloud Storage" },
  { pattern: "ICLOUD", category: "Subscriptions > Cloud Storage" },
  { pattern: "ADOBE", category: "Subscriptions > Software" },
  { pattern: "MICROSOFT 365", category: "Subscriptions > Software" },
  { pattern: "NYT", category: "Subscriptions > News" },
  { pattern: "WSJ", category: "Subscriptions > News" },

  // Utilities
  { pattern: "COMCAST", category: "Utilities > Internet" },
  { pattern: "XFINITY", category: "Utilities > Internet" },
  { pattern: "VERIZON", category: "Utilities > Phone" },
  { pattern: "T-MOBILE", category: "Utilities > Phone" },
  { pattern: "AT&T", category: "Utilities > Phone" },

  // Health
  { pattern: "CVS", category: "Health > Pharmacy" },
  { pattern: "WALGREENS", category: "Health > Pharmacy" },
  { pattern: "PLANET FITNESS", category: "Health > Gym" },

  // Personal
  { pattern: "VENMO", category: "Transfer" },
  { pattern: "ZELLE", category: "Transfer" },
  { pattern: "PAYPAL", category: "Transfer" },
];
