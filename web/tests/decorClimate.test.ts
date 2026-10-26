import {describe,expect,it} from 'vitest';
import {decorClimate} from '../src/ui/decorClimate';
describe('retained map climate',()=>{
 it('restores custom numbers rather than a default temperate climate',()=>{
  expect(decorClimate({query:'climate=custom&temperature=-3.5&precipitation=420',tags:{climate:'arid'}})).toMatchObject({temperature:-3.5,precipitation:420});
 });
 it('prefers serialized climate keys over legacy control names',()=>{
  expect(decorClimate({query:'climate=custom&temperature=7&climTemperature=28',tags:{}}).temperature).toBe(7);
 });
 it('restores a named preset from metadata when no query is retained',()=>{
  expect(decorClimate({query:'',tags:{climate:'cold'}})).toMatchObject({temperature:1,precipitation:550});
 });
});
