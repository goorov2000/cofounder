import {expect,it} from 'vitest';
import fixture from './fixtures/ui02-b-noop.json';
import {applyMemoryPatch,archiveMessage,getCurrentEntries} from '../../shared/coreMemory';
import type {Artifact,AtomicEntry,AtomicValue,MemoryPatch,Project} from '../../shared/types';
function setup(){
 const project=structuredClone(fixture) as unknown as Project;
 const id=project.core!.entries.find(e=>e.key==='trip_price')!.id;
 project.core!.entries=project.core!.entries.filter(e=>e.id!==id||e.version<=2);
 project.core!.revision=2;project.core!.contextVersion=2;project.core!.appliedRequestIds=[];
 project.modules.idea.artifact!.stale=false;delete project.modules.idea.artifact!.staleReason;
 project.modules.audience.artifact=null;
 return project;
}
function update(project:Project,entry:AtomicEntry):MemoryPatch{
 const {id,version,previousVersion,createdAt,requestId,...value}=entry;
 const source=value.sources.find(s=>s.type==='message')!;if(source.type!=='message')throw new Error('source');
 return {schemaVersion:1,projectId:project.id,moduleId:source.moduleId,generation:source.generation,requestId:`probe-update-${version}`,sourceMessage:{messageId:source.messageId,revision:source.revision},baseMemoryVersion:project.core!.revision,baseContextVersion:project.core!.contextVersion,operations:[{op:'revise',id,expectedVersion:getCurrentEntries(project.core!).find(e=>e.id===id)!.version,value}]};
}
const versions=fixture.core.entries.filter(e=>e.key==='trip_price') as unknown as AtomicEntry[];
it('preserves fresh materials through exact UI02 source-only v2→v3→v4 while retaining both audit revisions',()=>{
 let p=setup();const originalIdea=p.modules.idea.artifact;p=applyMemoryPatch(p,update(p,versions.find(e=>e.version===3)!));
 expect(p.modules.idea.artifact).toBe(originalIdea);
 expect(p.modules.idea.artifact!.stale).toBe(false);
 p.modules.audience.artifact=structuredClone(fixture.modules.audience.artifact) as unknown as Artifact;
 p.modules.audience.artifact!.stale=false;delete p.modules.audience.artifact!.staleReason;
 const originalAudience=p.modules.audience.artifact;
 p=applyMemoryPatch(p,update(p,versions.find(e=>e.version===4)!));
 expect(p.modules.idea.artifact).toBe(originalIdea);expect(p.modules.audience.artifact).toBe(originalAudience);
 expect(p.modules.idea.artifact!.stale).toBe(false);expect(p.modules.audience.artifact!.stale).toBe(false);
 expect(p.core!.entries.filter(e=>e.key==='trip_price').map(e=>e.version)).toEqual([1,2,3,4]);
 expect(p.core!.entries.filter(e=>e.key==='trip_price').map(e=>e.sources)).toEqual(versions.map(e=>e.sources));
 const text=versions[3].text.replace('700','800');
 p=archiveMessage(p,'competitors',{id:'actual-change',role:'user',content:text,createdAt:p.updatedAt});
 const patch=update(p,versions[3]);patch.requestId='actual-new-price';patch.sourceMessage={messageId:'actual-change',revision:1};
 patch.operations[0].value.text=text;patch.operations[0].value.sources=[{type:'message',projectId:p.id,moduleId:'competitors',generation:0,messageId:'actual-change',revision:1,quote:text}];
 p=applyMemoryPatch(p,patch);
 expect(p.modules.idea.artifact!.stale).toBe(true);expect(p.modules.audience.artifact!.stale).toBe(true);
});
for(const [name,change] of Object.entries({unit:(v:AtomicValue):void=>{v.text=v.text.replace('за выезд','за час');},negation:(v:AtomicValue):void=>{v.text=v.text.replace('диагностика включена','диагностика не включена');},status:(v:AtomicValue):void=>{v.acceptance='rejected';}}))it(`still invalidates on meaningful ${name}`,()=>{
 let p=setup();const patch=update(p,versions[2]);change(patch.operations[0].value);
 const text=patch.operations[0].value.text;
 p=archiveMessage(p,'audience',{id:`change-${name}`,role:'user',content:text,createdAt:p.updatedAt});
 patch.baseContextVersion=p.core!.contextVersion;patch.sourceMessage={messageId:`change-${name}`,revision:1};
 patch.operations[0].value.sources=[{type:'message',projectId:p.id,moduleId:'audience',generation:0,messageId:`change-${name}`,revision:1,quote:text}];
 expect(applyMemoryPatch(p,patch).modules.idea.artifact!.stale).toBe(true);
});
