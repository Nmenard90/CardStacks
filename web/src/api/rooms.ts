import { api } from './client'
import type { CardAllocation, CollectionSpace, DisplayCase, DisplayCaseType, InventoryLot, ProtectionType, SpaceType, StorageUnit, StorageUnitType } from '../types'

export const listSpaces=(userId:string)=>api.get<CollectionSpace[]>(`/api/spaces/${userId}`).then(r=>r.data)
export const createSpace=(userId:string,name:string,spaceType:SpaceType='custom')=>
  api.post<CollectionSpace>(`/api/spaces/${userId}`,{name,spaceType}).then(r=>r.data)

export interface NewStorageUnit { spaceId:string;name:string;unitType:StorageUnitType;preset:string;color:string;shelfCount:number;positionsPerShelf:number;maxStackHeight:number;config?:string }
export const createStorageUnit=(userId:string,value:NewStorageUnit)=>api.post<StorageUnit>(`/api/spaces/${userId}/storage-units`,value).then(r=>r.data)
export const placeBox=(userId:string,boxId:string,value:{spaceId:string;unitId:string;shelfIndex:number;stackIndex:number;stackLevel:number})=>
  api.put(`/api/spaces/${userId}/boxes/${boxId}/placement`,value).then(r=>r.data)
export const placeBinder=(userId:string,binderId:string,value:{spaceId:string;unitId:string;shelfIndex:number;shelfPosition:number})=>
  api.put(`/api/spaces/${userId}/binders/${binderId}/placement`,value).then(r=>r.data)

export interface NewDisplayCase { spaceId:string;name:string;caseType:DisplayCaseType;preset:string;frameColor:string;lightColor:string;shelfCount:number;slotsPerShelf:number;config?:string }
export const createDisplayCase=(userId:string,value:NewDisplayCase)=>api.post<DisplayCase>(`/api/spaces/${userId}/display-cases`,value).then(r=>r.data)
export const setDisplayLights=(userId:string,caseId:string,enabled:boolean)=>api.put(`/api/spaces/${userId}/display-cases/${caseId}/lights`,{enabled}).then(r=>r.data)

export const getSpaceInventory=(userId:string)=>api.get<InventoryLot[]>(`/api/spaces/${userId}/inventory`).then(r=>r.data)
export interface PlaceCopies { lotId:string;drawerId?:string;binderSlotId?:string;displaySlotId?:string;quantity:number;protection?:ProtectionType;notes?:string }
export const placeCopies=(userId:string,value:PlaceCopies)=>api.post<CardAllocation>(`/api/spaces/${userId}/allocations`,value).then(r=>r.data)
export const removePlacement=(userId:string,id:string)=>api.delete(`/api/spaces/${userId}/allocations/${id}`).then(r=>r.data)
