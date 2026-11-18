import {setText,translate} from './i18n';

interface Choice<T extends string>{value:T;label:string;primary?:boolean;danger?:boolean}
let queued:Promise<unknown>=Promise.resolve();
/** Application-owned modal: shared palette, explicit action labels, focus and keyboard handling. */
export function chooseAction<T extends string>(options:{id:string;title:string;message:string;details?:readonly string[];choices:readonly Choice<T>[];cancelValue?:T;remember?:string}):Promise<{value:T|undefined;remember:boolean}>{
  const task=queued.then(()=>new Promise<{value:T|undefined;remember:boolean}>(resolve=>{
    const modal=document.createElement('dialog');modal.id=options.id;modal.className='v2-action-dialog';
    modal.style.width='min(500px,94vw)';
    const head=document.createElement('div');head.className='dialog-head';
    const title=document.createElement('h2');title.id=`${options.id}-title`;setText(title,options.title);
    modal.setAttribute('aria-labelledby',title.id);
    const close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label',translate('Close'));
    head.append(title,close);modal.append(head);
    const message=document.createElement('p');message.className='hint';message.id=`${options.id}-message`;setText(message,options.message);
    modal.setAttribute('aria-describedby',message.id);modal.append(message);
    if(options.details?.length){const list=document.createElement('ul');for(const text of options.details){const item=document.createElement('li');item.textContent=text;list.append(item);}modal.append(list);}
    const remember=document.createElement('input');remember.type='checkbox';remember.checked=true;
    if(options.remember){const label=document.createElement('label');label.className='checkline';label.style.marginTop='16px';const caption=document.createElement('span');setText(caption,options.remember);label.append(remember,caption);modal.append(label);}
    let settled=false;
    const finish=(value:T|undefined)=>{if(settled)return;settled=true;modal.close();modal.remove();resolve({value,remember:!!options.remember&&remember.checked});};
    close.onclick=()=>finish(options.cancelValue);
    modal.addEventListener('cancel',event=>{event.preventDefault();finish(options.cancelValue);});
    modal.addEventListener('close',()=>finish(options.cancelValue));
    modal.addEventListener('keydown',event=>event.stopPropagation());
    const actions=document.createElement('div');actions.className='dialog-actions';actions.style.flexWrap='wrap';
    for(const choice of options.choices){const button=document.createElement('button');button.type='button';setText(button,choice.label);button.dataset.choice=choice.value;
      if(choice.primary){button.classList.add('primary');button.autofocus=true;}if(choice.danger)button.classList.add('danger');button.onclick=()=>finish(choice.value);actions.append(button);}
    modal.append(actions);document.body.append(modal);modal.showModal();
  }));
  queued=task.catch(()=>{});return task;
}
export async function confirmAction(message:string,options:{id:string;title?:string;confirmLabel?:string;danger?:boolean}):Promise<boolean>{
  const result=await chooseAction({id:options.id,title:options.title??'Confirm action',message,cancelValue:'cancel',choices:[{value:'cancel',label:'Cancel'},
    {value:'confirm',label:options.confirmLabel??'Continue',primary:true,danger:options.danger}]});
  return result.value==='confirm';
}
