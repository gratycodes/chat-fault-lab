import { convertCurrency, runDemoTool } from './tools';

describe('convertCurrency', () => {
  it('converts with the fixed demo rates', () => {
    expect(convertCurrency({ amount: 120, from: 'EUR', to: 'INR' })).toEqual({ amount: 120, from: 'EUR', to: 'INR', rate: 91.2, result: 10944 });
    expect(convertCurrency({ amount: 10, from: 'usd', to: 'eur' }).result).toBeCloseTo(9.17, 2);
  });
  it('rejects bad input', () => {
    expect(() => convertCurrency({ amount: 'x', from: 'EUR', to: 'INR' })).toThrow(/number/);
    expect(() => convertCurrency({ amount: 1, from: 'EUR', to: 'XYZ' })).toThrow(/unsupported/);
  });
  it('rejects unknown tools', async () => {
    await expect(runDemoTool('rm_rf', {})).rejects.toThrow(/unknown tool/);
  });
});
