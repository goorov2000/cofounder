import { expect, it } from 'vitest';
import { groundedQuantities } from '../../shared/coreValidation';

it('does not treat a creator time zone as hourly billing', () => {
  const claim = 'Teamwork: автоматизации по датам задач работают в часовом поясе создателя автоматизации.';
  const quote = "Automations based on task dates or estimated/logged time run on the automation creator's time zone.";
  expect(groundedQuantities(claim, quote)).toBe(true);
});

it.each(['в час', 'за час', '/час', 'за часов', 'в часах'])('still requires a quoted hour unit for %s', unit => {
  expect(groundedQuantities(`Цена 20 ₽ ${unit}`, 'Цена 20 ₽.')).toBe(false);
  expect(groundedQuantities(`Цена 20 ₽ ${unit}`, 'Цена 20 ₽ / hour.')).toBe(true);
});

it('keeps amount and currency checks in time-zone statements', () => {
  expect(groundedQuantities('В часовом поясе создателя: 21 ₽.', '20 ₽.')).toBe(false);
  expect(groundedQuantities('В часовом поясе создателя: 20 €.', '20 ₽.')).toBe(false);
});
