/**
 * The one demo tool. Rates are fixed, made-up numbers so the demo and tests
 * are deterministic; they are not market data.
 */

export const DEMO_RATES: Record<string, number> = {
  EUR: 1,
  USD: 1.09,
  GBP: 0.86,
  INR: 91.2,
  AED: 4.0,
};

export const convertCurrencyTool = {
  type: 'function' as const,
  function: {
    name: 'convert_currency',
    description: 'Convert an amount between currencies using fixed demo rates.',
    parameters: {
      type: 'object',
      properties: {
        amount: { type: 'number' },
        from: { type: 'string', enum: Object.keys(DEMO_RATES) },
        to: { type: 'string', enum: Object.keys(DEMO_RATES) },
      },
      required: ['amount', 'from', 'to'],
    },
  },
};

export interface ConversionResult {
  amount: number;
  from: string;
  to: string;
  rate: number;
  result: number;
}

export function convertCurrency(args: Record<string, unknown>): ConversionResult {
  const amount = Number(args.amount);
  const from = String(args.from ?? '').toUpperCase();
  const to = String(args.to ?? '').toUpperCase();
  if (!Number.isFinite(amount)) throw new Error('amount must be a number');
  const a = DEMO_RATES[from];
  const b = DEMO_RATES[to];
  if (a === undefined || b === undefined) throw new Error(`unsupported currency pair ${from}/${to}`);
  const rate = b / a;
  return { amount, from, to, rate: round(rate, 4), result: round(amount * rate, 2) };
}

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

export type ToolRunner = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export const runDemoTool: ToolRunner = async (name, args) => {
  if (name === 'convert_currency') return convertCurrency(args);
  throw new Error(`unknown tool ${name}`);
};
