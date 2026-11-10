const list = (value: string | undefined) => (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/** Read lazily, so a build never needs secrets. */
export const env = {
  get databaseUrl() {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    return url;
  },
  get rpcUrls() {
    const urls = list(process.env.RPC_URLS);
    return urls.length ? urls : ['http://127.0.0.1:8899'];
  },
  get cluster() {
    return process.env.NEXT_PUBLIC_CLUSTER ?? 'localnet';
  },
  get siteUrl() {
    return process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  },
  get cronSecret() {
    return process.env.CRON_SECRET ?? '';
  },
  get adminWallets() {
    return list(process.env.ADMIN_WALLETS);
  },
  /** `next dev` against a local validator. Never true in a deployed build. */
  get localDev() {
    return process.env.NODE_ENV === 'development' && (process.env.NEXT_PUBLIC_CLUSTER ?? 'localnet') === 'localnet';
  },
  /** Operators are the wallets in ADMIN_WALLETS. With none listed, only local development lets any wallet in. */
  isOperator(wallet: string): boolean {
    const wallets = list(process.env.ADMIN_WALLETS);
    return wallets.length === 0 ? env.localDev : wallets.includes(wallet);
  },
  get adminSecret() {
    return process.env.ADMIN_SESSION_SECRET ?? '';
  },
  get webhookSecret() {
    return process.env.HELIUS_WEBHOOK_SECRET ?? '';
  },
  /** If the platform gives no country, assume the operator's home jurisdiction. It's the safer default. */
  get defaultCountry() {
    return process.env.DEFAULT_COUNTRY ?? 'IN';
  },
  /** The key behind the claim page's test SOL tap, in the Solana CLI's JSON keypair form. Never read on mainnet. */
  get faucetSecret() {
    return (process.env.NEXT_PUBLIC_CLUSTER ?? 'localnet') === 'mainnet-beta' ? '' : (process.env.FAUCET_SECRET ?? '');
  },
  get telegram() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chat = process.env.TELEGRAM_CHAT_ID;
    return token && chat ? { token, chat } : null;
  },
  get email() {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.ALERT_EMAIL_FROM;
    const to = process.env.ALERT_EMAIL_TO;
    return key && from && to ? { key, from, to } : null;
  },
};
