import {expect,it} from 'vitest';
import {missingPromisedInlineContent} from '../../server/inlineArtifactPromise';
const request={message:'Учебный пример: мастерская делает столы на заказ. Покажи карточку прямо в сообщении, без открытия черновика.'};
const artifactDraft={title:'Карточка учебного проекта',body:'Продукт: столы на заказ.\nКлиент: неизвестен.\nПроблема: не проверена.\nСледующий шаг: разобрать последний заказ мебели.'};
const issue={path:['message'],rule:'missing_promised_inline_content'};
for(const message of [
 'Ниже — карточка проекта.',
 'Учебная мастерская делает столы. Ниже — карточка, которая отделяет ваше предположение от того, что ещё нужно выяснить.',
 'Учебная мастерская делает столы. Вот она; пока это гипотеза, а не подтверждённая проблема.',
 'Чтобы не заставлять вас искать, привожу черновик здесь; он основан только на вашей идее и не подтверждает, что такая проблема уже есть у людей.',
 'Карточка ниже — вот она.',
 'Учебная мастерская делает столы на заказ. Ниже — карточка проекта.',
 'Вы описали пошив штор на заказ. Вот она; пока это черновик.',
 'Покупатель пока неизвестен. Привожу черновик здесь; он основан на ваших вводных.',
 'Черновик готов. Откройте его отдельно.',
 'Подготовил карточку проекта. Её можно открыть по кнопке.',
])it(`rejects a finite terminal promise or requested inline handoff: ${message}`,()=>{
 const original={message,artifactDraft:structuredClone(artifactDraft)},before=structuredClone(original);
 expect(missingPromisedInlineContent(request,original)).toEqual(issue);expect(original).toEqual(before);
});
for(const message of [
 'Ниже — карточка проекта.\nПродукт: столы на заказ.\nКлиент: неизвестен.',
 'Ниже — карточка, которая отделяет ваше предположение от того, что ещё нужно выяснить.\nПродукт: столы на заказ. Клиент неизвестен.',
 'Вот она; пока это гипотеза, а не подтверждённая проблема.\nМастерская шьёт шторы. Следующий шаг — разобрать последний заказ.',
 'Чтобы не заставлять вас искать, привожу черновик здесь; он основан только на вашей идее и не подтверждает, что такая проблема уже есть у людей.\nПродукт: столы на заказ. Клиент неизвестен.',
 'Вот она: мастерская делает столы на заказ, а покупатель и проблема пока неизвестны.',
 'Привожу черновик здесь.\nМастерская шьёт шторы на заказ. Следующий шаг — разобрать последний заказ.',
 'Мастерская делает столы на заказ. Кто покупатель и какую проблему решаем, пока неизвестно. Следующий шаг — разобрать последний заказ мебели.',
 'Ниже — карточка проекта. Пока это черновик.\nЦена: неизвестна.',
 '«Ниже — карточка проекта.» — пример формулировки, а не обещание.',
 '```text\nНиже — карточка проекта.\n```',
])it(`allows actual content or literal text after a presentation cue: ${message}`,()=>expect(missingPromisedInlineContent(request,{message,artifactDraft})).toBeUndefined());
it('allows a separate draft handoff without an explicit current request to show it in chat',()=>{
 for(const message of ['Черновик готов. Откройте его отдельно.','Подготовил карточку проекта. Её можно открыть по кнопке.'])expect(missingPromisedInlineContent({message:'Подготовь сохраняемый черновик карточки.'},{message,artifactDraft})).toBeUndefined();
 expect(missingPromisedInlineContent({message:'Не показывайте карточку в чате, подготовьте отдельный черновик.'},{message:'Черновик готов. Откройте его отдельно.',artifactDraft})).toBeUndefined();
});
it('requires an actual nonempty artifact body and does not invent an inline body',()=>{
 for(const artifact of [null,{title:'Карточка',body:''}])expect(missingPromisedInlineContent(request,{message:'Ниже — карточка проекта.',artifactDraft:artifact})).toBeUndefined();
});

it('does not reject an entire artifact body already visible before a later presentation cue',()=>expect(missingPromisedInlineContent(request,{message:artifactDraft.body+'\nНиже — карточка проекта.',artifactDraft})).toBeUndefined());
