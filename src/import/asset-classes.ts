// Auto-classify investment holdings by symbol or name pattern

const SYMBOL_ASSET_CLASS: Record<string, string> = {
  // US Total Market / Large Cap
  VTI: "us_stock", VTSAX: "us_stock", SWTSX: "us_stock", FSKAX: "us_stock", ITOT: "us_stock",
  VOO: "us_stock", VFIAX: "us_stock", SWPPX: "us_stock", FXAIX: "us_stock", SPY: "us_stock",
  IVV: "us_stock", VV: "us_stock", SCHX: "us_stock", SCHB: "us_stock", SPTM: "us_stock",
  // US Mid/Small Cap
  VO: "us_stock", VB: "us_stock", VXF: "us_stock", VEXAX: "us_stock",
  IJR: "us_stock", IJH: "us_stock", SCHA: "us_stock", SCHM: "us_stock",
  // US Growth / Value
  VUG: "us_stock", VTV: "us_stock", SCHG: "us_stock", SCHV: "us_stock",
  QQQ: "us_stock", QQQM: "us_stock", MGK: "us_stock",
  // International Developed
  VXUS: "intl_stock", VTIAX: "intl_stock", IXUS: "intl_stock", SWISX: "intl_stock",
  VEA: "intl_stock", VTMGX: "intl_stock", SCHF: "intl_stock", EFA: "intl_stock",
  FSPSX: "intl_stock",
  // International Emerging
  VWO: "intl_stock", VEMAX: "intl_stock", SCHE: "intl_stock", EEM: "intl_stock",
  IEMG: "intl_stock", FPADX: "intl_stock",
  // Bonds
  BND: "bond", VBTLX: "bond", AGG: "bond", SCHZ: "bond", FXNAX: "bond",
  BNDX: "bond", VTABX: "bond", IAGG: "bond",
  BSV: "bond", BIV: "bond", BLV: "bond", VCSH: "bond", VCIT: "bond", VCLT: "bond",
  TLT: "bond", IEF: "bond", SHY: "bond", GOVT: "bond", TIPS: "bond", VTIP: "bond",
  VGSH: "bond", VGIT: "bond", VGLT: "bond",
  HYG: "bond", JNK: "bond", LQD: "bond", MUB: "bond", TFI: "bond",
  // Real Estate
  VNQ: "real_estate", VGSLX: "real_estate", SCHH: "real_estate", IYR: "real_estate",
  VNQI: "real_estate", REET: "real_estate",
  // Commodities
  GLD: "commodity", IAU: "commodity", SLV: "commodity", PDBC: "commodity",
  GSG: "commodity", DJP: "commodity", GLDM: "commodity",
  // Crypto
  GBTC: "crypto", ETHE: "crypto", BITO: "crypto", IBIT: "crypto", FBTC: "crypto",
  // Cash / Money Market
  FDRXX: "cash", SNAXX: "cash", VMFXX: "cash", SWVXX: "cash", SPAXX: "cash",
  SPRXX: "cash", TTTXX: "cash", FZDXX: "cash", BIL: "cash", SHV: "cash",
  SGOV: "cash", USFR: "cash",
  // Target Date (Vanguard/Fidelity/Schwab)
  VFIFX: "us_stock", VFFVX: "us_stock", VFORX: "us_stock", VTHRX: "us_stock",
  VTTVX: "us_stock", VFIDX: "us_stock", VTWNX: "us_stock", VLXVX: "us_stock",
};

const NAME_PATTERNS: [RegExp, string][] = [
  [/money\s*market|settlement\s*fund|government\s*cash/i, "cash"],
  [/treasury\s*bill|t-bill/i, "cash"],
  [/bond|fixed\s*income|treasury|aggregate|debt|income\s*fund/i, "bond"],
  [/high\s*yield|municipal|muni\s*bond/i, "bond"],
  [/international|foreign|global|world|emerging|developed|ex-us|ex\s+us/i, "intl_stock"],
  [/reit|real\s*estate/i, "real_estate"],
  [/gold|silver|commodity|commodities|natural\s*resource/i, "commodity"],
  [/crypto|bitcoin|ethereum|digital\s*asset/i, "crypto"],
  [/target\s*(date|retirement)\s*\d{4}/i, "us_stock"],
  [/s&p\s*500|total\s*(stock|market)|large\s*cap|mid\s*cap|small\s*cap|growth|value|equity|stock\s*index/i, "us_stock"],
];

export function classifyAsset(symbol: string, name?: string): string | null {
  const upper = symbol.toUpperCase().trim();
  if (SYMBOL_ASSET_CLASS[upper]) {
    return SYMBOL_ASSET_CLASS[upper];
  }

  if (name) {
    for (const [pattern, assetClass] of NAME_PATTERNS) {
      if (pattern.test(name)) {
        return assetClass;
      }
    }
  }

  return null;
}
