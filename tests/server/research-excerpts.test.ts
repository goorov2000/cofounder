import {expect,it} from 'vitest';
import {extractPage} from '../../server/publicReader.js';
import {pageEvidence} from '../../server/research.js';
import type {ChatRequest} from '../../shared/types.js';

it('preserves mechanism documentation instead of exhausting its excerpts on numbered navigation and quick options',()=>{
 const request:ChatRequest={requestId:'excerpt-mechanism',projectId:'excerpt-project',moduleId:'competitors',intent:'message',message:'Проверь механизм напоминаний исполнителю',context:{name:'Test',description:'',facts:[],artifacts:[],history:[]}};
 const mechanism='Custom task reminders notify all assigned recipients, allow selecting other participants and stop after task completion.';
 const navigation=Array.from({length:24},(_,i)=>`<div>Navigation section ${i+1} ${'Unrelated navigation text. '.repeat(8)}</div>`).join('');
 const page=extractPage(`<title>Adding Task Reminders - Vendor Support</title>${navigation}<p>Quick set reminder options: later today - 2 hours later.</p><p>Tomorrow - 9AM the next day.</p><p>Next week - 9AM 7 days later.</p><p>${'General documentation text. '.repeat(25)}</p><p>${mechanism}</p>`,'https://vendor.example/docs/reminders');
 const evidence=pageEvidence(request,page,0);
 expect(evidence.quotes.some(q=>q.text.includes(mechanism))).toBe(true);
 expect(evidence.quotes.length).toBeLessThanOrEqual(5);
 expect(evidence.contentHash).toBe(page.contentHash);
 for(const quote of evidence.quotes){
  expect(quote.text.length).toBeLessThanOrEqual(500);
  expect(quote.start).not.toBeNull();expect(quote.end).not.toBeNull();
  expect(page.text.slice(quote.start!,quote.end!)).toBe(quote.text);
 }
});
