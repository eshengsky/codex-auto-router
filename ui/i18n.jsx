import {createContext,useContext} from 'react';
import {translate,errorText} from '../src/i18n.js';
export const LanguageContext=createContext('en');
export function useLanguage(){
 const language=useContext(LanguageContext);
 return {language,t:(key,values)=>translate(language,key,values),errorText:message=>errorText(language,message)};
}
