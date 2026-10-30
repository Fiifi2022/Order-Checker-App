import {createContext,useContext,useState,type ReactNode} from 'react';
export interface AllocationSelection {sheetId:string;district:string;cycle:string;rowId:string;facilityName:string;facilityId:string}
const empty:AllocationSelection={sheetId:'',district:'',cycle:'',rowId:'',facilityName:'',facilityId:''};
const Context=createContext({selection:empty,setSelection:(_patch:Partial<AllocationSelection>)=>{}});
export function AllocationWorkspaceProvider({children}:{children:ReactNode}) {
 const [selection,set]=useState(empty);
 return <Context.Provider value={{selection,setSelection:patch=>set(previous=>{
   const next={...previous,...patch};return JSON.stringify(next)===JSON.stringify(previous)?previous:next;
 })}}>{children}</Context.Provider>;
}
export const useAllocationWorkspace=()=>useContext(Context);
