import { render, screen, cleanup } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createProject } from '../../shared/domain';
import { calculateMarket, calculateEconomics } from '../../shared/calculations';
import { projectToMarkdown } from '../../shared/exports';
import { Calculator } from '../../src/features/workspace/Calculator';
const state=vi.hoisted(()=>({project:null as any,setProject:vi.fn()}));
vi.mock('../../src/state',()=>({useWorkspace:()=>state}));
it('F05 exposes stale market/economics and the reason in Calculator and Markdown without changing old values on view/export',()=>{
 const project=createProject(),reason='Изменена гипотеза цены: 5000 → 3500. Сверьте исходные значения.';
 project.calculations.market={...calculateMarket({totalBuyers:100,reachableBuyers:50,targetBuyers:10,price:5000,period:'месяц'}),stale:true,staleReason:reason};
 project.calculations.economics={...calculateEconomics({customers:10,price:5000,period:'месяц'}),stale:true,staleReason:reason};state.project=project;
 const before=structuredClone(project);
 for(const moduleId of ['market','economics'] as const){render(<Calculator moduleId={moduleId}/>);expect(screen.getByRole('status')).toHaveTextContent(reason);expect(screen.getByRole('status')).toHaveTextContent('Проверьте актуальность вводных.');expect(screen.getByLabelText(moduleId==='market'?'Расходы одного покупателя':'Доход от одного клиента')).toHaveValue('5000');cleanup();}
 const markdown=projectToMarkdown(project);expect(markdown.split(reason)).toHaveLength(3);expect(markdown).toContain('50000');expect(markdown).toContain('5000');expect(project).toEqual(before);expect(state.setProject).not.toHaveBeenCalled();
});
