import { expect, it } from 'vitest';
import { calculateEconomics, calculateMarket, parseNonNegative } from '../../shared/calculations';

it('reproduces market and cash scenarios while keeping unknown costs, invalid values and incompatible periods unknown', () => {
  const market = calculateMarket({ totalBuyers: 1000, reachableBuyers: 200, targetBuyers: 10, price: 500, period: 'месяц' });
  expect(market.results.tam.value).toBe(500000);
  expect(market.results.sam.value).toBe(100000);
  expect(market.results.som.value).toBe(5000);
  expect(market.results.tam).toMatchObject({ unit: '₽', period: 'месяц' });
  expect(market.results.tam.formula).toContain('1000');
  expect(market.inputs.price.provenance).toBe('hypothesis');
  expect(calculateMarket({ totalBuyers: 10, reachableBuyers: 20, targetBuyers: 30, price: 5, period: 'год' }).results.sam.value).toBeNull();
  expect(calculateMarket({ totalBuyers: 100, reachableBuyers: 20, targetBuyers: 3, price: 5, period: 'год', pricePeriod: 'месяц' }).results.tam.value).toBeNull();
  const economics = calculateEconomics({ customers: 10, price: 500, variableCostPerCustomer: 100, fixedCost: 1000, acquisitionCost: 600, newCustomers: 3, period: 'месяц', sources: { price: 'Цена со слов пользователя' } });
  expect(Object.fromEntries(Object.entries(economics.results).map(([key, entry]) => [key, entry.value]))).toEqual({ revenue: 5000, variableCost: 1000, contribution: 4000, profit: 3000, cac: 200, ltv: null });
  expect(economics.inputs.price.source).toBe('Цена со слов пользователя');
  const unknown = calculateEconomics({ customers: 10, price: 500, fixedCost: '', acquisitionCost: 600, newCustomers: 0, period: 'месяц' });
  expect(unknown.results.revenue.value).toBe(5000);
  expect(unknown.results.contribution.value).toBeNull();
  expect(unknown.results.profit.value).toBeNull();
  expect(unknown.results.cac.value).toBeNull();
  expect(calculateEconomics({ customers: 1e308, price: 1e308, period: 'месяц' }).results.revenue.value).toBeNull();
  expect(calculateEconomics({ customers: 0, price: 500, variableCostPerCustomer: 0, fixedCost: 50, period: 'месяц' }).results.profit.value).toBe(-50);
  for (const value of ['', '  ', null, undefined, NaN, Infinity, -1, '-1', 'abc', '12руб', '0x10']) expect(parseNonNegative(value)).toBeNull();
  expect(parseNonNegative('0')).toBe(0);
  expect(parseNonNegative('12,5')).toBe(12.5);
  expect(parseNonNegative('101', { percent: true })).toBeNull();
});
