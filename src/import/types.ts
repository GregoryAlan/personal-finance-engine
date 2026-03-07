export interface ColumnMapping {
  date: string;
  description: string;
  amount?: string;
  debit?: string;
  credit?: string;
  category?: string;
  type?: string;
  balance?: string;
  check_number?: string;
}

export interface ImportConfig {
  institution: string;
  columns: ColumnMapping;
  dateFormat?: string;
  invertAmount?: boolean;        // Amex/Discover: positive = charge
  skipRows?: number;
  headerRow?: number;
  csvDelimiter?: string;
}

export interface RawTransaction {
  date: string;
  description: string;
  amount: number;
  category?: string;
  type?: string;
  balance?: string;
  check_number?: string;
  raw_line: string;
}

export interface ImportResult {
  batch_id: string;
  institution: string;
  account_id: number;
  filename: string;
  imported: number;
  skipped: number;
  errors: string[];
  date_range: { start: string; end: string };
}
