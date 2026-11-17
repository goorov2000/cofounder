import { useState } from 'react';
import { CalculationWorkbench } from './CalculationWorkbench';
import { Button } from './components';
import { calculationReport, type StoredCalculation } from '../../shared/calculationScenario';

function example(): StoredCalculation {
  const values = { totalBuyers: '10000', reachableBuyers: '2000', targetBuyers: '60', price: '8000', period: 'год', pricePeriod: 'год', currency: '₽' };
  return { ...calculationReport('market', values, Object.fromEntries(Object.keys(values).map(key => [key, 'Гипотеза наставника: учебный сценарий, не рыночная статистика.'])), Object.fromEntries(Object.keys(values).map(key => [key, 'hypothesis']))), pricePeriod: 'год', fieldOrigins: Object.fromEntries(Object.keys(values).map(key => [key, 'conversation'])) };
}
export function CalculationExample() {
  const [stored, setStored] = useState<StoredCalculation | undefined>(example);
  return <><div className="ds-example-row"><Button size="sm" onClick={() => setStored(example())}>Показать сценарий из диалога</Button><Button size="sm" variant="ghost" onClick={() => setStored(undefined)}>Показать пустой расчёт</Button></div><CalculationWorkbench moduleId="market" stored={stored} onChange={setStored} /></>;
}
